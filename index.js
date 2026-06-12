const express = require('express');
const cors = require('cors');
const { MOVIES } = require('@consumet/extensions');

const app = express();
app.use(cors());
app.use(express.json());

const flixhq = new MOVIES.FlixHQ();
const sflix = new MOVIES.SFlix();
const goku = new MOVIES.Goku();
const himovies = new MOVIES.HiMovies();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'private-cinema-api' });
});

// Helper function to add a timeout to any promise
function timeoutPromise(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).then(
    (result) => {
      clearTimeout(timeoutId);
      return result;
    },
    (err) => {
      clearTimeout(timeoutId);
      throw err;
    }
  );
}

// Helper function to resolve using a given provider
async function resolveProvider(provider, title, year, req) {
  const providerName = provider.name || 'Provider';
  console.log(`Searching ${providerName} for: "${title}" (${year || 'any year'})`);
  
  // Wrap search in 5s timeout
  const searchResults = await timeoutPromise(provider.search(title), 5000);
  
  if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
    throw new Error(`No media matches found on ${providerName}.`);
  }

  // Match by year / type if possible, or fall back to first result
  let matchedItem = searchResults.results[0];
  if (year) {
    const yearMatch = searchResults.results.find(item => 
      item.releaseDate && item.releaseDate.toString().includes(year.toString())
    );
    if (yearMatch) matchedItem = yearMatch;
  }

  console.log(`Matched on ${providerName}: "${matchedItem.title}" (ID: ${matchedItem.id})`);

  // Wrap media info in 5s timeout
  const mediaInfo = await timeoutPromise(provider.fetchMediaInfo(matchedItem.id), 5000);
  if (!mediaInfo || !mediaInfo.episodes || mediaInfo.episodes.length === 0) {
    throw new Error(`Could not fetch media episodes on ${providerName}.`);
  }

  let targetEpisodeId = '';
  if (mediaInfo.type === 'Movie') {
    targetEpisodeId = mediaInfo.episodes[0].id;
  } else {
    // TV Series
    const targetSeason = req.query.season ? parseInt(req.query.season.toString()) : 1;
    const targetEpisode = req.query.episode ? parseInt(req.query.episode.toString()) : 1;
    
    const foundEpisode = mediaInfo.episodes.find(ep => 
      ep.season === targetSeason && ep.number === targetEpisode
    ) || mediaInfo.episodes[0];
    
    targetEpisodeId = foundEpisode.id;
  }

  console.log(`Fetching stream sources for episode ID: ${targetEpisodeId} on ${providerName}`);
  
  // Wrap episode sources in 7s timeout
  const sources = await timeoutPromise(provider.fetchEpisodeSources(targetEpisodeId, matchedItem.id), 7000);

  if (!sources || !sources.sources || sources.sources.length === 0) {
    throw new Error(`No streaming sources found on ${providerName}.`);
  }

  return {
    title: matchedItem.title,
    type: matchedItem.type,
    id: matchedItem.id,
    episodeId: targetEpisodeId,
    provider: providerName,
    ...sources
  };
}

// Endpoint to resolve stream by movie title and year
app.get('/api/resolve', async (req, res) => {
  const { title, year } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'Title parameter is required' });
  }

  const providers = [
    { name: 'FlixHQ', instance: flixhq },
    { name: 'SFlix', instance: sflix },
    { name: 'Goku', instance: goku },
    { name: 'HiMovies', instance: himovies }
  ];

  // Map each provider to a promise that resolves or rejects
  const promises = providers.map(async (prov) => {
    try {
      // Allow max 8 seconds total for a single provider resolution flow
      return await timeoutPromise(resolveProvider(prov.instance, title, year, req), 8000);
    } catch (err) {
      console.warn(`${prov.name} failed: ${err.message || err}`);
      // Reject with the error message so Promise.any aggregate error has it
      throw new Error(err.message || err);
    }
  });

  try {
    const result = await Promise.any(promises);
    return res.json(result);
  } catch (aggregateError) {
    const details = {};
    providers.forEach((prov, idx) => {
      details[prov.name.toLowerCase()] = aggregateError.errors[idx]?.message || aggregateError.errors[idx] || 'Unknown error';
    });
    res.status(500).json({
      error: 'All stream providers failed.',
      details: details
    });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

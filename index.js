const express = require('express');
const cors = require('cors');
const { MOVIES } = require('@consumet/extensions');

const app = express();
app.use(cors());
app.use(express.json());

const flixhq = new MOVIES.FlixHQ();
const sflix = new MOVIES.SFlix();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'private-cinema-api' });
});

// Helper function to resolve using a given provider
async function resolveProvider(provider, title, year, req) {
  const providerName = provider.name || 'Provider';
  console.log(`Searching ${providerName} for: "${title}" (${year || 'any year'})`);
  const searchResults = await provider.search(title);
  
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

  // Fetch details
  const mediaInfo = await provider.fetchMediaInfo(matchedItem.id);
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
  const sources = await provider.fetchEpisodeSources(targetEpisodeId, matchedItem.id);

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

  // Try FlixHQ first
  try {
    const result = await resolveProvider(flixhq, title, year, req);
    return res.json(result);
  } catch (err1) {
    console.warn(`FlixHQ failed, trying SFlix fallback. Error: ${err1.message || err1}`);
    
    // Fall back to SFlix
    try {
      const result = await resolveProvider(sflix, title, year, req);
      return res.json(result);
    } catch (err2) {
      console.error(`SFlix fallback failed as well. Error: ${err2.message || err2}`);
      return res.status(500).json({ 
        error: 'All stream providers failed.',
        flixhqError: err1.message || err1,
        sflixError: err2.message || err2
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const express = require('express');
const cors = require('cors');
const { MOVIES } = require('@consumet/extensions');

const app = express();
app.use(cors());
app.use(express.json());

const flixhq = new MOVIES.FlixHQ();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'private-cinema-api' });
});

// Endpoint to resolve stream by movie title and year
app.get('/api/resolve', async (req, res) => {
  try {
    const { title, year, type } = req.query; // type can be 'movie' or 'tv'
    if (!title) {
      return res.status(400).json({ error: 'Title parameter is required' });
    }

    console.log(`Searching FlixHQ for: "${title}" (${year || 'any year'})`);
    const searchResults = await flixhq.search(title);
    
    if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
      return res.status(404).json({ error: 'No media matches found on FlixHQ.' });
    }

    // Match by year / type if possible, or fall back to first result
    let matchedItem = searchResults.results[0];
    if (year) {
      const yearMatch = searchResults.results.find(item => 
        item.releaseDate && item.releaseDate.toString().includes(year.toString())
      );
      if (yearMatch) matchedItem = yearMatch;
    }

    console.log(`Matched item: "${matchedItem.title}" (ID: ${matchedItem.id}, Type: ${matchedItem.type})`);

    // Fetch details to get episodes
    const mediaInfo = await flixhq.fetchMediaInfo(matchedItem.id);
    if (!mediaInfo || !mediaInfo.episodes || mediaInfo.episodes.length === 0) {
      return res.status(404).json({ error: 'Could not fetch media episodes.' });
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

    console.log(`Fetching stream sources for episode ID: ${targetEpisodeId}`);
    const sources = await flixhq.fetchEpisodeSources(targetEpisodeId, matchedItem.id);

    if (!sources || !sources.sources || sources.sources.length === 0) {
      return res.status(404).json({ error: 'No streaming sources found for this episode.' });
    }

    // Return sources with original headers
    res.json({
      title: matchedItem.title,
      type: matchedItem.type,
      id: matchedItem.id,
      episodeId: targetEpisodeId,
      ...sources
    });
  } catch (err) {
    console.error('Error resolving stream:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

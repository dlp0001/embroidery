const crypto = require('crypto');

const BUNNY_TOKEN_KEY = process.env.BUNNY_TOKEN_KEY;
const LIBRARY_ID = '675652';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  // Token valid for 4 hours
  const expires = Math.floor(Date.now() / 1000) + (4 * 60 * 60);

  // Bunny Stream embed token: SHA256_HEX(security_key + video_id + expiration)
  const hashable = BUNNY_TOKEN_KEY + videoId + expires;
  const token = crypto.createHash('sha256').update(hashable).digest('hex');

  const embedUrl = `https://player.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}?token=${token}&expires=${expires}&autoplay=false&loop=false&muted=false&preload=true&responsive=true`;

  return res.status(200).json({ embedUrl });
};

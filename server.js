/**
 * TV Backend - YouTube to MP4 URL Converter + Twitch Clip Extractor
 * Deploy on Render.com (Web Service)
 *
 * API:
 *   POST /api/convert     YouTube → MP4 direct URL
 *   POST /api/twitch-clip Twitch clip → MP4 direct URL
 *   GET  /api/info        YouTube video metadata
 *   GET  /health          Health check
 */

const express = require("express");
const cors = require("cors");
const ytdl = require("@distube/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

/**
 * POST /api/convert - YouTube → MP4
 */
app.post("/api/convert", async (req, res) => {
	const { url } = req.body;
	if (!url) return res.status(400).json({ success: false, error: "Missing 'url'" });

	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) return res.status(400).json({ success: false, error: "Invalid YouTube URL" });

	console.log(`Converting: ${url}`);
	try {
		const info = await ytdl.getInfo(url);
		let selectedFormat = null;
		const formats = info.formats;

		const combined = formats.filter(f => f.hasAudio && f.hasVideo && (f.container === "mp4" || f.container === "webm"));
		if (combined.length > 0) {
			combined.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combined[0];
		} else {
			const videoOnly = formats.filter(f => f.hasVideo && f.container === "mp4");
			videoOnly.sort((a, b) => (b.height || 0) - (a.height || 0));
			if (videoOnly.length > 0) selectedFormat = videoOnly[0];
		}

		if (selectedFormat?.url) {
			return res.json({ success: true, url: selectedFormat.url, title: info.videoDetails.title, videoId: info.videoDetails.videoId, quality: selectedFormat.qualityLabel || "unknown" });
		}
		for (const f of formats) {
			if (f.url) return res.json({ success: true, url: f.url, title: info.videoDetails.title, videoId: info.videoDetails.videoId, quality: f.qualityLabel || "unknown" });
		}
		res.status(404).json({ success: false, error: "No playable format found" });
	} catch (err) {
		const msg = err.message || "";
		if (msg.includes("429")) return res.status(429).json({ success: false, error: "YouTube rate limit" });
		if (msg.includes("403")) return res.status(403).json({ success: false, error: "Video indisponible" });
		console.error(`Error: ${msg}`);
		res.status(500).json({ success: false, error: `Conversion failed: ${msg}` });
	}
});

/**
 * POST /api/twitch-clip - Twitch clip → direct MP4 URL
 */
app.post("/api/twitch-clip", async (req, res) => {
	const { url } = req.body;
	if (!url) return res.status(400).json({ success: false, error: "Missing 'url'" });

	let slug = null;
	let match = url.match(/twitch\.tv\/[^\/]+\/clip\/([a-zA-Z0-9_\-]+)/);
	if (match) slug = match[1];
	if (!slug) {
		match = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_\-]+)/);
		if (match) slug = match[1];
	}
	if (!slug) return res.status(400).json({ success: false, error: "Invalid Twitch clip URL" });

	console.log(`Twitch clip slug: ${slug}`);
	try {
		const response = await fetch("https://gql.twitch.tv/gql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
			},
			body: JSON.stringify({
				query: `query($slug: ID!) { clip(slug: $slug) { title slug videoQualities { quality sourceURL } } }`,
				variables: { slug },
			}),
		});

		if (!response.ok) return res.status(502).json({ success: false, error: `Twitch API error ${response.status}` });

		const data = await response.json();
		if (!data?.data?.clip) return res.status(404).json({ success: false, error: "Clip not found" });

		const qualities = data.data.clip.videoQualities;
		if (!qualities?.length) return res.status(404).json({ success: false, error: "No video qualities found" });

		qualities.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
		const best = qualities[0];

		console.log(`Twitch clip: "${data.data.clip.title}" - ${best.quality}p`);
		return res.json({ success: true, url: best.sourceURL, title: data.data.clip.title, slug: data.data.clip.slug, quality: `${best.quality}p` });
	} catch (err) {
		console.error(`Twitch clip error: ${err.message}`);
		res.status(500).json({ success: false, error: `Twitch clip failed: ${err.message}` });
	}
});

/**
 * GET /api/info - YouTube metadata
 */
app.get("/api/info", async (req, res) => {
	const { url, id } = req.query;
	const videoUrl = url || (id ? `https://www.youtube.com/watch?v=${id}` : null);
	if (!videoUrl) return res.status(400).json({ success: false, error: "Provide 'url' or 'id'" });
	try {
		const info = await ytdl.getInfo(videoUrl);
		res.json({ success: true, title: info.videoDetails.title, videoId: info.videoDetails.videoId, lengthSeconds: parseInt(info.videoDetails.lengthSeconds), author: info.videoDetails.author.name, thumbnails: info.videoDetails.thumbnails });
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
});

/**
 * GET /health
 */
app.get("/health", (req, res) => {
	res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.listen(PORT, "0.0.0.0", () => {
	console.log(`TV Backend running on port ${PORT}`);
	console.log(`Health: GET /health`);
	console.log(`YouTube: POST /api/convert`);
	console.log(`Twitch: POST /api/twitch-clip`);
});

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

// Middleware
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

/**
 * POST /api/convert
 * Convert a YouTube URL to a direct MP4 video URL
 */
app.post("/api/convert", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({ success: false, error: "Missing 'url' in request body" });
	}

	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) {
		return res.status(400).json({ success: false, error: "Invalid YouTube URL" });
	}

	console.log(`Converting: ${url}`);

	try {
		console.log(`Fetching video info...`);
		const info = await ytdl.getInfo(url);
		const title = info.videoDetails.title;
		const videoId = info.videoDetails.videoId;

		console.log(`Video: "${title}" (${videoId})`);

		let selectedFormat = null;
		const formats = info.formats;

		// Combined format (audio+video)
		const combinedFormats = formats.filter(
			(f) => f.hasAudio && f.hasVideo && (f.container === "mp4" || f.container === "webm")
		);

		if (combinedFormats.length > 0) {
			combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combinedFormats[0];
			console.log(`Selected combined: ${selectedFormat.qualityLabel || "?"} (${selectedFormat.container})`);
		} else {
			// Fallback: video only (no audio)
			const videoFormats = formats.filter((f) => f.hasVideo && f.container === "mp4");
			videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			if (videoFormats.length > 0) {
				selectedFormat = videoFormats[0];
				console.log(`Selected video-only: ${selectedFormat.qualityLabel || "?"}`);
			}
		}

		if (selectedFormat && selectedFormat.url) {
			return res.json({ success: true, url: selectedFormat.url, title, videoId, quality: selectedFormat.qualityLabel || "unknown" });
		}

		// Last resort: any format with a URL
		for (const f of formats) {
			if (f.url) {
				return res.json({ success: true, url: f.url, title, videoId, quality: f.qualityLabel || "unknown" });
			}
		}

		res.status(404).json({ success: false, error: "No playable format found" });
	} catch (err) {
		const msg = err.message || "Unknown error";
		if (msg.includes("429") || msg.includes("Too Many Requests")) {
			console.error(`YOUTUBE RATE LIMITED: ${msg}`);
			return res.status(429).json({ success: false, error: "YouTube rate limit. Attendez 30min ou ajoutez YT_COOKIES (voir README)" });
		}
		if (msg.includes("403") || msg.includes("Private video")) {
			return res.status(403).json({ success: false, error: "Video indisponible ou privée" });
		}
		console.error(`Error: ${msg}`);
		res.status(500).json({ success: false, error: `Conversion failed: ${msg}` });
	}
});

/**
 * POST /api/twitch-clip
 * Extract direct MP4 URL from a Twitch clip
 */
app.post("/api/twitch-clip", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({ success: false, error: "Missing 'url' in request body" });
	}

	// Extract clip slug from URL
	let slug = null;
	let match = url.match(/twitch\.tv\/[^\/]+\/clip\/([a-zA-Z0-9_\-]+)/);
	if (match) slug = match[1];
	if (!slug) {
		match = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_\-]+)/);
		if (match) slug = match[1];
	}
	if (!slug) {
		return res.status(400).json({ success: false, error: "Invalid Twitch clip URL" });
	}

	console.log(`Twitch clip slug: ${slug}`);

	try {
		const response = await fetch("https://gql.twitch.tv/gql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Client-ID": "kimne78kx3ncx6nsoe1e6o7098e72o0h3",
			},
			body: JSON.stringify({
				query: `query($slug: String!) { clip(slug: $slug) { title slug videoQualities { quality sourceURL } } }`,
				variables: { slug },
			}),
		});

		if (!response.ok) {
			return res.status(502).json({ success: false, error: `Twitch API error ${response.status}` });
		}

		const data = await response.json();
		if (!data?.data?.clip) {
			return res.status(404).json({ success: false, error: "Clip not found on Twitch" });
		}

		const qualities = data.data.clip.videoQualities;
		if (!qualities || qualities.length === 0) {
			return res.status(404).json({ success: false, error: "No video qualities found" });
		}

		qualities.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
		const best = qualities[0];

		console.log(`Twitch clip: "${data.data.clip.title}" - ${best.quality}p`);

		return res.json({
			success: true,
			url: best.sourceURL,
			title: data.data.clip.title,
			slug: data.data.clip.slug,
			quality: `${best.quality}p`,
		});
	} catch (err) {
		console.error(`Twitch clip error: ${err.message}`);
		res.status(500).json({ success: false, error: `Twitch clip failed: ${err.message}` });
	}
});

/**
 * GET /api/info
 * Get YouTube video metadata only
 */
app.get("/api/info", async (req, res) => {
	const { url, id } = req.query;
	const videoUrl = url || (id ? `https://www.youtube.com/watch?v=${id}` : null);
	if (!videoUrl) return res.status(400).json({ success: false, error: "Provide 'url' or 'id'" });

	try {
		const info = await ytdl.getInfo(videoUrl);
		res.json({
			success: true,
			title: info.videoDetails.title,
			videoId: info.videoDetails.videoId,
			lengthSeconds: parseInt(info.videoDetails.lengthSeconds),
			author: info.videoDetails.author.name,
			thumbnails: info.videoDetails.thumbnails,
		});
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

// Start server
app.listen(PORT, "0.0.0.0", () => {
	console.log(`TV Backend running on port ${PORT}`);
	console.log(`Health: http://localhost:${PORT}/health`);
	console.log(`Convert: POST /api/convert`);
	console.log(`Twitch:  POST /api/twitch-clip`);
});

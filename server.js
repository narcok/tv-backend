/**
 * TV Backend - YouTube to MP4 URL Converter
 * Deploy on Render.com (Web Service)
 *
 * API:
 *   POST /api/convert
 *   Body: { "url": "https://www.youtube.com/watch?v=..." }
 *   Response: { "success": true, "url": "https://...", "title": "..." }
 *
 *   GET /health
 *   Response: { "status": "ok" }
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

app.post("/api/convert", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: "Missing 'url' in request body",
		});
	}

	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) {
		return res.status(400).json({
			success: false,
			error: "Invalid YouTube URL",
		});
	}

	console.log(`Converting: ${url}`);

	try {
		const info = await ytdl.getInfo(url);
		const title = info.videoDetails.title;
		const videoId = info.videoDetails.videoId;

		console.log(`Video: "${title}" (${videoId})`);

		let selectedFormat = null;
		const formats = info.formats;
		console.log(`Available formats: ${formats.length}`);

		// Log available formats for debugging
		for (const f of formats) {
			if (f.hasVideo) {
				console.log(`  Format: ${f.itag} ${f.qualityLabel || "?"} ${f.container} ${f.codecs || "?"} audio=${f.hasAudio}`);
			}
		}

		// Try to find a combined format (both audio+video) in mp4 or webm
		const combinedFormats = formats.filter(
			(f) => f.hasAudio && f.hasVideo && (f.container === "mp4" || f.container === "webm")
		);

		if (combinedFormats.length > 0) {
			combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combinedFormats[0];
			console.log(`Selected: ${selectedFormat.qualityLabel || "?"} (${selectedFormat.container}) itag:${selectedFormat.itag}`);
		} else {
			// Fallback: best video-only mp4
			const videoFormats = formats.filter(
				(f) => f.hasVideo && f.container === "mp4"
			);
			videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

			if (videoFormats.length > 0) {
				selectedFormat = videoFormats[0];
				console.log(`Selected video-only: ${selectedFormat.qualityLabel || "?"} (${selectedFormat.container})`);
			}
		}

		if (selectedFormat && selectedFormat.url) {
			return res.json({
				success: true,
				url: selectedFormat.url,
				title: title,
				videoId: videoId,
				quality: selectedFormat.qualityLabel || "unknown",
			});
		}

		// Last resort
		for (const f of formats) {
			if (f.url) {
				return res.json({
					success: true,
					url: f.url,
					title: title,
					videoId: videoId,
					quality: f.qualityLabel || "unknown",
				});
			}
		}

		res.status(404).json({
			success: false,
			error: "No playable format found",
		});
	} catch (err) {
		console.error(`Error: ${err.message}`);
		res.status(500).json({
			success: false,
			error: `Conversion failed: ${err.message}`,
		});
	}
});

app.get("/api/info", async (req, res) => {
	const { url, id } = req.query;
	const videoUrl = url || (id ? `https://www.youtube.com/watch?v=${id}` : null);

	if (!videoUrl) {
		return res.status(400).json({ success: false, error: "Provide 'url' or 'id'" });
	}

	try {
		const info = await ytdl.getInfo(videoUrl);
		res.json({
			success: true,
			title: info.videoDetails.title,
			videoId: info.videoDetails.videoId,
			lengthSeconds: parseInt(info.videoDetails.lengthSeconds),
			author: info.videoDetails.author.name,
		});
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
});

app.get("/health", (req, res) => {
	res.json({ status: "ok", uptime: process.uptime() });
});

app.listen(PORT, "0.0.0.0", () => {
	console.log(`TV Backend running on port ${PORT}`);
	console.log(`API: POST ${PORT}/api/convert`);
});

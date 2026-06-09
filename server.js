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

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
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
		return res.status(400).json({
			success: false,
			error: "Missing 'url' in request body",
		});
	}

	// Validate YouTube URL
	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) {
		return res.status(400).json({
			success: false,
			error: "Invalid YouTube URL",
		});
	}

	console.log(`Converting: ${url}`);

	try {
		// Get video info from YouTube
		const info = await ytdl.getInfo(url);
		const title = info.videoDetails.title;
		const videoId = info.videoDetails.videoId;

		console.log(`Video: "${title}" (${videoId})`);

		// Try to find a format with both audio and video (highest quality)
		let selectedFormat = null;

		// Priority: try to get a combined audio+video format
		const formats = info.formats;

		// First, look for a good quality combined format (both audio and video)
		const combinedFormats = formats.filter(
			(f) => f.hasAudio && f.hasVideo && f.container === "mp4"
		);

		if (combinedFormats.length > 0) {
			// Sort by quality (resolution height), highest first
			combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combinedFormats[0];
			console.log(
				`Selected combined format: ${selectedFormat.qualityLabel} (${selectedFormat.container})`
			);
		} else {
			// Fallback: best video format + note that audio might be missing
			const videoFormats = formats.filter(
				(f) => f.hasVideo && f.container === "mp4"
			);
			videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

			if (videoFormats.length > 0) {
				selectedFormat = videoFormats[0];
				console.log(
					`Selected video-only format: ${selectedFormat.qualityLabel} (${selectedFormat.container})`
				);
			}
		}

		if (selectedFormat && selectedFormat.url) {
			console.log(`Returning URL (${selectedFormat.url.length} chars)`);
			return res.json({
				success: true,
				url: selectedFormat.url,
				title: title,
				videoId: videoId,
				quality: selectedFormat.qualityLabel || "unknown",
			});
		}

		// Last resort: try to get any URL from any format
		for (const f of formats) {
			if (f.url) {
				console.log(`Fallback format: ${f.qualityLabel || "unknown"}`);
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
			error: "No playable format found for this video",
		});
	} catch (err) {
		console.error(`Error converting ${url}:`, err.message);
		res.status(500).json({
			success: false,
			error: `Conversion failed: ${err.message}`,
		});
	}
});

/**
 * GET /api/info
 * Get video metadata only (no URL conversion)
 */
app.get("/api/info", async (req, res) => {
	const { url, id } = req.query;
	const videoUrl =
		url || (id ? `https://www.youtube.com/watch?v=${id}` : null);

	if (!videoUrl) {
		return res.status(400).json({
			success: false,
			error: "Provide 'url' or 'id' query parameter",
		});
	}

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
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
	res.json({
		status: "ok",
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	});
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
	console.log(`TV Backend running on port ${PORT}`);
	console.log(`Health check: http://localhost:${PORT}/health`);
	console.log(`Convert API: POST http://localhost:${PORT}/api/convert`);
});

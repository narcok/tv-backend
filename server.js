/**
 * TV Backend - YouTube to MP4 URL Converter + Twitch Clip Extractor
 * Deploy on Render.com (Web Service)
 *
 * API:
 *   POST /api/convert     YouTube → MP4 direct URL
 *   POST /api/twitch-clip Twitch clip → MP4 direct URL (via signed CloudFront)
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
	if (!/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url))
		return res.status(400).json({ success: false, error: "Invalid YouTube URL" });

	try {
		const info = await ytdl.getInfo(url);
		const formats = info.formats;
		let selected = formats.filter(f => f.hasAudio && f.hasVideo && (f.container === "mp4" || f.container === "webm"));
		if (selected.length === 0) selected = formats.filter(f => f.hasVideo && f.container === "mp4");
		selected.sort((a, b) => (b.height || 0) - (a.height || 0));
		const best = selected[0];
		if (best?.url) return res.json({ success: true, url: best.url, title: info.videoDetails.title, videoId: info.videoDetails.videoId, quality: best.qualityLabel || "unknown" });
		for (const f of formats) { if (f.url) return res.json({ success: true, url: f.url, title: info.videoDetails.title, videoId: info.videoDetails.videoId, quality: f.qualityLabel || "unknown" }); }
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
 * POST /api/twitch-clip - Twitch clip → signed MP4 URL
 */
app.post("/api/twitch-clip", async (req, res) => {
	const { url } = req.body;
	if (!url) return res.status(400).json({ success: false, error: "Missing 'url'" });

	let slug = null;
	let m = url.match(/twitch\.tv\/[^\/]+\/clip\/([a-zA-Z0-9_\-]+)/);
	if (m) slug = m[1];
	if (!slug) { m = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_\-]+)/); if (m) slug = m[1]; }
	if (!slug) return res.status(400).json({ success: false, error: "Invalid Twitch clip URL" });

	console.log(`Twitch clip slug: ${slug}`);
	try {
		const resp = await fetch("https://gql.twitch.tv/gql", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko" },
			body: JSON.stringify({
				operationName: "ShareClipRenderStatus",
				variables: { slug },
				extensions: { persistedQuery: { version: 1, sha256Hash: "324783ea014524fa10a88739aa507de7a52f9624574dba9739a52b8c97d885cf" } },
			}),
		});
		if (!resp.ok) return res.status(502).json({ success: false, error: `Twitch API error ${resp.status}` });
		const data = await resp.json();
		if (!data?.data?.clip) return res.status(404).json({ success: false, error: "Clip not found" });

		const clip = data.data.clip;
		const qualities = clip.videoQualities;
		const token = clip.playbackAccessToken;
		if (!qualities?.length) return res.status(404).json({ success: false, error: "No video qualities found" });
		if (!token?.signature || !token?.value) return res.status(403).json({ success: false, error: "Clip requires authentication" });

		qualities.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));
		const best = qualities[0];
		const signedUrl = best.sourceURL + "?sig=" + token.signature + "&token=" + encodeURIComponent(token.value);

		console.log(`Twitch clip: "${clip.title}" - ${best.quality}p`);
		return res.json({ success: true, url: signedUrl, title: clip.title, slug: clip.slug, quality: `${best.quality}p` });
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
	} catch (err) { res.status(500).json({ success: false, error: err.message }); }
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
	console.log(`Twitch:  POST /api/twitch-clip`);
});

import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 5177);
createApp().listen(PORT, () => console.log(`▶ NCE Class API on http://localhost:${PORT}`));

import { sqlite } from './db/client.js';
import { migrate } from './db/provision.js';

// app.ts prepares statements at module load, so the schema must exist before it
// is imported — hence the dynamic import. migrate() is idempotent DDL, making a
// fresh (empty-volume) boot work without a manual step.
migrate(sqlite);

const { createApp } = await import('./app.js');

const PORT = Number(process.env.PORT || 5177);
createApp().listen(PORT, () => console.log(`▶ NCE Class API on http://localhost:${PORT}`));

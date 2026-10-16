import { main } from './engine';

main().catch((e: Error) => {
  console.error(`[streamclips] ${e.message}`);
  process.exit(1);
});

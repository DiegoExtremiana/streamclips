"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("./engine");
(0, engine_1.main)().catch((e) => {
    console.error(`[streamclips] ${e.message}`);
    process.exit(1);
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
(0, runner_1.main)().catch((e) => {
    console.error(`[streamclips] ${e.message}`);
    process.exit(1);
});

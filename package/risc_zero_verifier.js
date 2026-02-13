import * as wasm from "./risc_zero_verifier_bg.wasm";
import { __wbg_set_wasm } from "./risc_zero_verifier_bg.js";
__wbg_set_wasm(wasm);
export * from "./risc_zero_verifier_bg.js";

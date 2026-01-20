import 'dotenv/config';
import repl from "pretty-repl";
import NetworkLayer from "./networking/NetworkLayer.js";
const options = {
    prompt: '→ '
};

// repl.start(options);

const netLayer = new NetworkLayer();



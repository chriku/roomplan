import 'dotenv/config';
import repl from "pretty-repl";
import NetworkLayer from "./networking/NetworkLayer.js";
const options = {
    prompt: '→ '
};

const replInstance = repl.start(options);
replInstance.context.netLayerTest = () => new NetworkLayer();

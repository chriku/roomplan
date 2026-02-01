import repl from "pretty-repl";
import { Room } from "./model/room.js";

const options = {
    prompt: '→ '
};

const replInstance = repl.start(options);
// replInstance.context.netLayerTest = () => new NetworkLayer(); <== commented out until @schurpl merged
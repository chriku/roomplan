import repl from "pretty-repl";

const options = {
    prompt: '→ '
};

const replInstance = repl.start(options);
// replInstance.context.netLayerTest = () => new NetworkLayer(); <== commented out until @schurpl merged
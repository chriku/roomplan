import repl from "pretty-repl";
import { Room } from "./model/room.js";
import { Node } from "./model/node.js";
import commands from "./commands.js"
import { OperationManager } from "./model/operation_manager.js";
import { NetworkManager } from "./model/network_manager.js";
import { NetworkLayer } from "./model/network_layer.js";
import { v4 as uuidv4 } from 'uuid';
import readline from "node:readline";
import { read } from "node:fs";

const options = {
    prompt: '',
    ignoreUndefined: true
};
const replInstance = repl.start(options);
const history: string[] = [];
console.log = function (...args) {
    history.push(args.toString().replaceAll("\n", "").substring(0, process.stdout.columns - 2));
    const pos = replInstance.getCursorPos();
    for (let i = 0; i < process.stdout.rows - 2; i++) {
        readline.cursorTo(process.stdout, 0, i);
        readline.clearLine(process.stdout, 0);
        process.stdout.write((history[i + history.length - (process.stdout.rows - 2)] ?? " - "));
    }
    readline.cursorTo(process.stdout, pos.cols, process.stdout.rows - 2);
};


NetworkLayer.singleton = new NetworkLayer();
NetworkManager.singleton = new NetworkManager(uuidv4(), NetworkLayer.singleton);
OperationManager.singleton = new OperationManager(NetworkManager.singleton!.selfNode);//TODO: better declaration
setTimeout(() => {
    OperationManager.singleton!.start();
}, 3500);

// replInstance.context.netLayerTest = () => new NetworkLayer(); <== commented out until @schurpl merged
Object.assign(replInstance.context, commands);


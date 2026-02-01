import repl from "pretty-repl";
import { Room } from "./model/room.js";
import { Node } from "./model/node.js";
import commands from "./commands.js"
import { OperationManager } from "./model/operation_manager.js";

const options = {
    prompt: '→ '
};

OperationManager.singleton = new OperationManager(new Node("TODO"));//TODO: better declaration

const replInstance = repl.start(options);
// replInstance.context.netLayerTest = () => new NetworkLayer(); <== commented out until @schurpl merged
Object.assign(replInstance.context, commands);
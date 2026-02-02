import repl from "pretty-repl";
import { Room } from "./model/room.js";
import { Node } from "./model/node.js";
import commands from "./commands.js"
import { OperationManager } from "./model/operation_manager.js";
import { NetworkManager } from "./model/network_manager.js";
import { NetworkLayer } from "./model/network_layer.js";
import { v4 as uuidv4 } from 'uuid';

const options = {
    prompt: '→ '
};

NetworkLayer.singleton = new NetworkLayer();
NetworkManager.singleton = new NetworkManager(uuidv4(), NetworkLayer.singleton);
OperationManager.singleton = new OperationManager(NetworkManager.singleton!.selfNode);//TODO: better declaration

const replInstance = repl.start(options);
// replInstance.context.netLayerTest = () => new NetworkLayer(); <== commented out until @schurpl merged
Object.assign(replInstance.context, commands);
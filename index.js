"use strict"

/**
 * Dependencies
 */
const local = require('./config/local.js')
const CircularJSON = require("circular-json")
const _ = require('lodash')
const fork = require("child_process").fork


/**
 * Blitz.js module builder
 */
class Blitz {

    /**
     * Set global blitz config system
     */
    constructor(options) {
        // Merge existing blitz global with current if a new instance is
        // called inside a worker itself (necessary for hooking further
        // sub components)
        if (global.blitz) {
            blitz = _.merge(this, blitz)
            blitz.log.class = require("./config/logger.js")
        }

        // No instance was run before
        else {
            global.blitz = this
            blitz.config = {}
            blitz.nodes = {}
            blitz.log = new(require("./config/logger.js"))
            blitz.log.class = require("./config/logger.js")
        }

        let config = {
            local: local,
            provided: options
        }

        this.setConfig("local", config)
    }


    /**
     * Attach module config to global blitz object
     */
    setConfig(id, config) {
        let merged = _.merge(config.local, config.provided)
        blitz.config[id] = {}

        // Add each key to global blitz object
        for (var property in merged) {
            blitz.config[id][property] = merged[property]
        }
    }


    /**
     * Hook functions to be executed before specific node is clustered while making node config available to the Hook
     */
    hook(node, fn) {
        let id = typeof node === "string" ? node : node.name.toLowerCase()

        // Create global node obj if not existing
        if (!blitz.nodes[id]) {
            blitz.nodes[id] = {}
        }

        // Create hook stack to be executed before cluster()
        if (!blitz.nodes[id].hooks) {
            blitz.nodes[id].hooks = []
        }

        blitz.nodes[id].hooks.push(fn)
    }


    /**
     * Execute hooks for specific node
     */
    runHooks(id) {
        if (blitz.nodes[id].hooks) {
            blitz.nodes[id].hooks.forEach(hook => hook())
        }
    }


    /**
     * Let blitz handle framework modules
     */
    use(node) {
        let nid = node.config.provided ? node.config.provided.id : undefined
        let id = nid ? nid : node.constructor.name.toLowerCase()

        // Property already set? Merge them.
        if (blitz.nodes[id]) {
            blitz.nodes[id] = _.merge(blitz.nodes[id], node)
        }

        // Property not assigned before
        else {
            blitz.nodes[id] = {}
        }

        this.setConfig(id, node.config)
        this.runHooks(id)
        this.cluster(node, id)
    }


    /**
     * Create workers from node file
     */
    cluster(node, id) {
        let file = node.filename
        let cores = 1 //blitz.config[id].cores

        // Fork Workers
        blitz.nodes[id].workers = []
        for (let i = 0; i < cores; i++) {

            // Add to node's worker list to be accessible globally
            blitz.nodes[id].workers.push(fork(file, {
                env: {
                    isWorker: true
                }
            }))

            // Send global blitz to worker
            blitz.id = id
            blitz.nodes[id].workers[i].send({
                type: "setGlobal",
                data: this.serialize(blitz)
            })

            // Make Worker methods accessible from global blitz
            this.exposeMethods(node, id)

            // Restart worker on exit
            blitz.nodes[id].workers[i].on("exit", (code, signal) => {
                blitz.nodes[id].workers.push(fork(file))
            })
        }
    }


    /**
     * Make Worker methods accessible from global blitz
     */
    exposeMethods(node, id) {
        for (let method of Object.getOwnPropertyNames(Object.getPrototypeOf(node))) {
            let _this = this

            // Direct request via stdout to worker
            blitz.nodes[id][method] = function() {
                blitz.nodes[id].workers.forEach(worker => {
                    worker.send({
                        type: "call",
                        value: {
                            method: method,
                            args: _this.serialize(arguments)
                        }
                    })
                })
            }
        }
    }


    /**
     * Serialize global blitz object so it can be sent via stdout to workers
     */
    serialize(obj) {
        return CircularJSON.stringify(obj, (key, value) => {
            return (typeof value === 'function') ? value.toString() : value
        })
    }
}


/**
 * Pass options to constructor on require
 */
module.exports = (options) => {
    new Blitz(options)
}
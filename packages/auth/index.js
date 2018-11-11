const Core = require('cubic-core')
const API = require('cubic-api')
const local = require('./config/local.js')
const preauth = require('./hooks/preauth.js')

/**
 * Loader for auth-node system. For ease of maintenance, the auth-node consists
 * of a core-node that is connected to its own api-node as web server, much
 * like a regular cubic project
 */
class Auth {
  constructor (options) {
    this.config = {
      local: local,
      provided: options || {}
    }
  }

  async init () {
    // Core Node which processes incoming requests
    cubic.hook('auth.core', preauth.verifyUserIndices)
    cubic.use(new Core(cubic.config.auth.core))

    // API node for distributing requests
    await cubic.use(new API(cubic.config.auth.api))
    if (!cubic.config.auth.api.disable) {
      preauth.validateWorker()

      // Re-hook this middleware when the auth core disconnects again
      const app = cubic.nodes.auth.api.server.ws.app
      cubic.nodes.auth.api.server.ws.app.on('connection', spark => {
        if (!spark.request.user.scp.includes('write_auth')) return

        // No more auth nodes remaining
        spark.on('end', () => {
          if (!app.adapter.nodes.find(n => n.scp.includes('write_auth'))) {
            preauth.validateWorker()
          }
        })
      })
    }
  }
}

module.exports = Auth

/**
 * @file
 * @copyright (c) 2013 Stephan Brenner
 * @license   This project is released under the MIT License.
 *
 * This file implements a Node.js module for initiating socket.io connections
 * through a proxy server.
 */

(function(){
    var http = require('http');
    var https = require('https');
    var url = require('url');
    var io = require('socket.io-client');
    var querystring = require('querystring');

    var tunnelPort = 61423;
    var tunnelServer;
    var initialized = false;
    var query;

    exports.connect = function(destinationUrl, options) {
        var destination = url.parse(destinationUrl);
        if (!destination.port) {
            destination.port = destination.protocol === 'https:' ? 443 : 80;
        }
        query = querystring.parse(destination.query);

        if (!initialized) exports.init();

        if (typeof tunnelServer === 'undefined') return io.connect(destinationUrl, options);   // Direct connection

        options = options || {};
        options['force new connection'] = true;   // Allows one tunnel server to handle multiple destinations

        return io.connect('http://localhost:' + tunnelPort + '/' +
            '?protocol=' + destination.protocol.replace(':', '')  +
            '&hostname=' + destination.hostname +
            '&port=' + destination.port, options);
    };

    exports.init = function(proxyUrl) {
        initialized = true;

        if (typeof tunnelServer !== 'undefined') {
            tunnelServer.close();
            tunnelServer = undefined;
        }

        if (typeof proxyUrl === 'undefined') {
            if (process.env.http_proxy) {
                proxyUrl = process.env.http_proxy;
            } else {
                console.log('Direct connection (no proxy defined)');
                return;
            }
        }

        var proxy = url.parse(proxyUrl, true);

        tunnelServer = http.createServer(function (request, response) {
            var requestUrl = url.parse(request.url, true);
            var hostname = requestUrl.query.hostname;
            var port = requestUrl.query.port;

            for(key in requestUrl.query) {
                if(key == 'protocol' || key == 'hostname' || key == 'port') continue;
                query[key] = requestUrl.query[key];
            }

            var options = {
                hostname: typeof proxy !== 'undefined' ? proxy.hostname : hostname,
                port: typeof proxy !== 'undefined' ? proxy.port : port,
                path: requestUrl.pathname + '?' + querystring.stringify(query),
                method: request.method,
                headers: request.headers
            };
            options['headers']['Host'] = hostname + ':' + port;

            var proxy_request = requestUrl.query.protocol === 'http'
                ? http.request(options)
                : https.request(options);

            proxy_request.addListener('response', function (proxy_response) {
                proxy_response.addListener('data', function (chunk) { response.write(chunk, 'binary'); });
                proxy_response.addListener('end', function () { response.end(); });
                response.writeHead(proxy_response.statusCode, proxy_response.headers);
            });

            proxy_request.on('error', function(err) {
               console.log('Error: found error in socket.io-proxy - error is: ' + err);
               console.log(err.stack);
            });

            request.addListener('data', function (chunk) { proxy_request.write(chunk, 'binary'); });
            request.addListener('end', function () { proxy_request.end(); });
        });

        tunnelServer.listen(tunnelPort);
        console.log('Proxy: ' + proxyUrl);
    };
})();

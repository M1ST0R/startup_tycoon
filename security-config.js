'use strict';

/**
 * Production sessions must never be sent over plain HTTP.
 * Development may opt in for local HTTPS, but cannot weaken production.
 */
function secureCookiesEnabled(environment, configuredValue) {
  return environment === 'production' || configuredValue === 'true';
}

module.exports = { secureCookiesEnabled };

// netlify/functions/fpl-proxy.js
// Forwards read-only requests to the public FPL API.
// Usage: /.netlify/functions/fpl-proxy?endpoint=entry/1234567/
//
// Only plain path characters are accepted (letters, digits, hyphens, slashes,
// and an optional simple query), so the path cannot escape to other hosts.

const FPL = 'https://fantasy.premierleague.com/api/';
const SAFE_PATH = /^[a-z0-9\-\/]+(\?[a-z0-9_=&\-]+)?$/i;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; KopalaFPL/1.0)',
  Accept: 'application/json',
};

exports.handler = async (event) => {
  const endpoint = (event.queryStringParameters?.endpoint || '').trim();

  if (!endpoint || !SAFE_PATH.test(endpoint)) {
    return json(400, { error: 'That request is not valid.' }, 'no-store');
  }

  let upstream;
  try {
    upstream = await fetch(FPL + endpoint, { headers: HEADERS });
  } catch {
    return json(502, { error: 'Could not reach FPL. Check your connection and try again.' }, 'no-store');
  }

  const text = await upstream.text();

  if (!upstream.ok) {
    const message = upstream.status === 404
      ? 'FPL could not find that data. Check the team ID.'
      : `FPL returned an error (${upstream.status}). Try again in a minute.`;
    return json(upstream.status === 404 ? 404 : 502, { error: message, upstreamStatus: upstream.status }, 'no-store');
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheFor(endpoint),
    },
    body: text,
  };
};

function cacheFor(endpoint) {
  if (endpoint.startsWith('event/')) return 'public, max-age=30';
  if (endpoint.startsWith('bootstrap-static')) return 'public, max-age=900';
  if (endpoint.startsWith('fixtures')) return 'public, max-age=60';
  return 'public, max-age=300';
}

function json(status, body, cacheControl) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheControl,
    },
    body: JSON.stringify(body),
  };
}

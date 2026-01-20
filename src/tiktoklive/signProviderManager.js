"use strict";

const { EventEmitter } = require("events");
const { SignConfig } = require("tiktok-live-connector/dist/lib/config");
const { EulerSigner } = require("tiktok-live-connector/dist/lib/web/lib/tiktok-signer");

const DEFAULT_PRIMARY_SIGN_HOST = "https://tiktok.eulerstream.com/";
const DEFAULT_SECONDARY_SIGN_HOST = "https://api.streamtoearn.io/apiserver/tiktok-signature/";

function normalizeSignHost(host) {
  if (!host) return null;
  const trimmed = `${host}`.trim();
  if (!trimmed) return null;
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  return `${withoutTrailing}/`;
}

function hostToBasePath(host) {
  if (!host) return null;
  return host.replace(/\/+$/, "");
}

function basePathToHost(basePath) {
  if (!basePath) return null;
  return `${basePath.replace(/\/+$/, "")}/`;
}

function parseFallbackHosts(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => normalizeSignHost(entry))
    .filter(Boolean);
}

const existingConfigHost = basePathToHost(SignConfig?.basePath);

function resolveFirstHost(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeSignHost(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

const primarySignHost = resolveFirstHost(
  process.env.PRIMARY_SIGN_API_URL,
  process.env.SIGN_PRIMARY_API_URL,
  DEFAULT_PRIMARY_SIGN_HOST,
  existingConfigHost
);

const secondarySignHostCandidateList = [
  process.env.SIGN_SECONDARY_API_URL,
  process.env.SIGN_API_URL,
  existingConfigHost && existingConfigHost !== primarySignHost ? existingConfigHost : null,
  DEFAULT_SECONDARY_SIGN_HOST
];

let secondarySignHost = null;
for (const candidate of secondarySignHostCandidateList) {
  const normalized = normalizeSignHost(candidate);
  if (normalized && normalized !== primarySignHost) {
    secondarySignHost = normalized;
    break;
  }
}

const originalSignProviderHost = primarySignHost;
const originalSignProviderBasePath = hostToBasePath(originalSignProviderHost);
const secondarySignBasePath = hostToBasePath(secondarySignHost);

const originalFallbackHosts = parseFallbackHosts(process.env.SIGN_PROVIDER_FALLBACKS).filter(
  (host) => host !== originalSignProviderHost && host !== secondarySignHost
);

const signProviderConfig = {
  signProviderHost: originalSignProviderHost,
  signProviderFallbackHosts: []
};

signProviderConfig.signProviderFallbackHosts = buildFallbackHostsForPrimary();
applyFallbackEnv(signProviderConfig.signProviderFallbackHosts);

if (originalSignProviderBasePath) {
  SignConfig.basePath = originalSignProviderBasePath;
  process.env.SIGN_API_URL = originalSignProviderBasePath;
}

if (secondarySignBasePath) {
  process.env.SIGN_FALLBACK_API_URL = secondarySignBasePath;
}

const signEvents = new EventEmitter();

if (EulerSigner && !EulerSigner.__s2eSignPatched) {
  const originalWebcastSign = EulerSigner.prototype.webcastSign;
  EulerSigner.prototype.webcastSign = async function patchedWebcastSign(url, ...rest) {
    try {
      const result = await originalWebcastSign.apply(this, [url, ...rest]);
      const signHost =
        normalizeSignHost(basePathToHost(this.configuration?.basePath)) ||
        normalizeSignHost(basePathToHost(SignConfig?.basePath));
      signEvents.emit("signSuccess", { signHost, originalUrl: url });
      return result;
    } catch (err) {
      signEvents.emit("signError", err);
      throw err;
    }
  };
  Object.defineProperty(EulerSigner, "__s2eSignPatched", { value: true });
}

function ensureFallbackArray() {
  if (!Array.isArray(signProviderConfig.signProviderFallbackHosts)) {
    signProviderConfig.signProviderFallbackHosts = [];
  }
  return signProviderConfig.signProviderFallbackHosts;
}

function resetArrayContents(targetArray, values) {
  targetArray.length = 0;
  values.forEach((value) => {
    if (value && !targetArray.includes(value)) {
      targetArray.push(value);
    }
  });
}

function buildFallbackHostsForPrimary() {
  const fallback = [];
  if (secondarySignHost && secondarySignHost !== originalSignProviderHost) {
    fallback.push(secondarySignHost);
  }
  originalFallbackHosts.forEach((host) => {
    if (host && !fallback.includes(host)) {
      fallback.push(host);
    }
  });
  return fallback;
}

function buildFallbackHostsForSecondary() {
  const fallback = [];
  if (originalSignProviderHost && originalSignProviderHost !== secondarySignHost) {
    fallback.push(originalSignProviderHost);
  }
  originalFallbackHosts.forEach((host) => {
    if (host && !fallback.includes(host) && host !== originalSignProviderHost) {
      fallback.push(host);
    }
  });
  return fallback;
}

function applyFallbackEnv(fallbackHosts) {
  const fallbackBasePath = hostToBasePath(fallbackHosts.find(Boolean));
  if (fallbackBasePath) {
    process.env.SIGN_FALLBACK_API_URL = fallbackBasePath;
  } else {
    delete process.env.SIGN_FALLBACK_API_URL;
  }
}

let globalSignHostMode = "primary";

function switchGlobalSignProviderHost(useSecondary) {
  const fallbackHosts = ensureFallbackArray();

  if (useSecondary) {
    if (!secondarySignHost) return;
    if (globalSignHostMode === "secondary" && signProviderConfig.signProviderHost === secondarySignHost) {
      return;
    }

    signProviderConfig.signProviderHost = secondarySignHost;
    if (SignConfig && secondarySignBasePath) {
      SignConfig.basePath = secondarySignBasePath;
      process.env.SIGN_API_URL = secondarySignBasePath;
    }

    const nextFallback = buildFallbackHostsForSecondary();
    resetArrayContents(fallbackHosts, nextFallback);
    applyFallbackEnv(nextFallback);
    globalSignHostMode = "secondary";

    console.log(
      "TTLiveEvents: global sign provider host set to secondary",
      secondarySignHost,
      "fallbacks:",
      [...fallbackHosts],
      "basePath:",
      SignConfig?.basePath
    );
  } else {
    if (globalSignHostMode === "primary" && signProviderConfig.signProviderHost === originalSignProviderHost) {
      return;
    }

    signProviderConfig.signProviderHost = originalSignProviderHost;
    if (SignConfig && originalSignProviderBasePath) {
      SignConfig.basePath = originalSignProviderBasePath;
      process.env.SIGN_API_URL = originalSignProviderBasePath;
    }

    const nextFallback = buildFallbackHostsForPrimary();
    resetArrayContents(fallbackHosts, nextFallback);
    applyFallbackEnv(nextFallback);
    globalSignHostMode = "primary";

    console.log(
      "TTLiveEvents: global sign provider host reset to primary",
      originalSignProviderHost,
      "fallbacks:",
      [...fallbackHosts],
      "basePath:",
      SignConfig?.basePath
    );
  }
}

function getCurrentSignHostLabel() {
  return globalSignHostMode === "secondary" ? secondarySignHost || originalSignProviderHost : originalSignProviderHost;
}

function isSecondaryHostConfigured() {
  return Boolean(secondarySignHost);
}

module.exports = {
  DEFAULT_PRIMARY_SIGN_HOST,
  DEFAULT_SECONDARY_SIGN_HOST,
  normalizeSignHost,
  hostToBasePath,
  switchGlobalSignProviderHost,
  getCurrentSignHostLabel,
  isSecondaryHostConfigured,
  getSecondarySignHost: () => secondarySignHost,
  getOriginalSignHost: () => originalSignProviderHost,
  signProviderConfig,
  signEvents,
};

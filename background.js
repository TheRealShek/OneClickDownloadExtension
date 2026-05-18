"use strict";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasDeclarativeNetRequest() {
  return Boolean(
    chrome.declarativeNetRequest &&
      chrome.declarativeNetRequest.getSessionRules &&
      chrome.declarativeNetRequest.updateSessionRules
  );
}

function getNextRuleId(callback) {
  chrome.declarativeNetRequest.getSessionRules(function (rules) {
    if (chrome.runtime.lastError) {
      callback(null);
      return;
    }

    var ids = (rules || []).map(function (rule) {
      return rule.id;
    });
    var id = 1;
    while (ids.indexOf(id) !== -1) {
      id += 1;
    }
    callback(id);
  });
}

function inferFilename(url) {
  if (!url) {
    return "image.jpg";
  }

  try {
    var parsed = new URL(url);
    var path = parsed.pathname || "";
    var segments = path.split("/").filter(Boolean);
    var last = segments[segments.length - 1] || "";
    var clean = last.split("?")[0].split("#")[0];
    if (!clean || clean.indexOf(".") === -1) {
      return "image.jpg";
    }
    return clean;
  } catch (err) {
    return "image.jpg";
  }
}

function buildRefererRule(ruleId, imageUrl, pageUrl) {
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Referer",
          operation: "set",
          value: pageUrl
        }
      ]
    },
    condition: {
      regexFilter: "^" + escapeRegex(imageUrl) + "$",
      resourceTypes: ["image", "other", "xmlhttprequest"]
    }
  };
}

function addDeclarativeRefererRule(imageUrl, pageUrl, callback) {
  getNextRuleId(function (ruleId) {
    if (!ruleId) {
      callback(null);
      return;
    }

    var rule = buildRefererRule(ruleId, imageUrl, pageUrl);

    chrome.declarativeNetRequest.updateSessionRules(
      {
        addRules: [rule],
        removeRuleIds: []
      },
      function () {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }
        callback(function () {
          chrome.declarativeNetRequest.updateSessionRules({
            addRules: [],
            removeRuleIds: [ruleId]
          });
        });
      }
    );
  });
}

function addWebRequestRefererRule(imageUrl, pageUrl, callback) {
  if (!chrome.webRequest || !chrome.webRequest.onBeforeSendHeaders) {
    callback(null);
    return;
  }

  function setReferer(details) {
    if (!details || details.url !== imageUrl) {
      return;
    }

    var headers = details.requestHeaders || [];
    var found = false;

    headers.forEach(function (header) {
      if (header.name && header.name.toLowerCase() === "referer") {
        header.value = pageUrl;
        found = true;
      }
    });

    if (!found) {
      headers.push({
        name: "Referer",
        value: pageUrl
      });
    }

    return { requestHeaders: headers };
  }

  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      setReferer,
      { urls: ["<all_urls>"] },
      ["blocking", "requestHeaders"]
    );
  } catch (err) {
    callback(null);
    return;
  }

  callback(function () {
    chrome.webRequest.onBeforeSendHeaders.removeListener(setReferer);
  });
}

function addRefererRule(imageUrl, pageUrl, callback) {
  if (!pageUrl) {
    callback(function () {});
    return;
  }

  if (hasDeclarativeNetRequest()) {
    addDeclarativeRefererRule(imageUrl, pageUrl, function (cleanupRefererRule) {
      if (cleanupRefererRule) {
        callback(cleanupRefererRule);
        return;
      }

      addWebRequestRefererRule(imageUrl, pageUrl, function (fallbackCleanup) {
        callback(fallbackCleanup || function () {});
      });
    });
    return;
  }

  addWebRequestRefererRule(imageUrl, pageUrl, function (cleanupRefererRule) {
    callback(cleanupRefererRule || function () {});
  });
}

function cleanupWhenDownloadEnds(downloadId, cleanupRefererRule) {
  var timeoutId = null;
  var cleanedUp = false;

  function done() {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    chrome.downloads.onChanged.removeListener(onChanged);
    cleanupRefererRule();
  }

  function onChanged(delta) {
    if (
      delta &&
      delta.id === downloadId &&
      delta.state &&
      (delta.state.current === "complete" || delta.state.current === "interrupted")
    ) {
      done();
    }
  }

  chrome.downloads.onChanged.addListener(onChanged);
  chrome.downloads.search({ id: downloadId }, function (items) {
    if (chrome.runtime.lastError || !items || !items[0]) {
      return;
    }

    if (items[0].state === "complete" || items[0].state === "interrupted") {
      done();
    }
  });
  timeoutId = setTimeout(done, 10 * 60 * 1000);
}

chrome.browserAction.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "scan-largest-image" }, function () {
    if (chrome.runtime.lastError) {
      return;
    }
  });
});

chrome.runtime.onMessage.addListener(function (message, sender) {
  if (!message || message.type !== "largest-image") {
    return;
  }

  var imageUrl = message.imageUrl;
  var pageUrl = message.pageUrl || (sender.tab && sender.tab.url) || "";

  if (!imageUrl) {
    return;
  }

  addRefererRule(imageUrl, pageUrl, function (cleanupRefererRule) {
    chrome.downloads.download({
      url: imageUrl,
      filename: inferFilename(imageUrl),
      conflictAction: "uniquify"
    }, function (downloadId) {
      if (chrome.runtime.lastError || typeof downloadId !== "number") {
        cleanupRefererRule();
        return;
      }

      cleanupWhenDownloadEnds(downloadId, cleanupRefererRule);
    });
  });
});

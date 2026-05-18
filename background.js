"use strict";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextRuleId(callback) {
  chrome.declarativeNetRequest.getSessionRules(function (rules) {
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
      regexFilter: escapeRegex(imageUrl),
      resourceTypes: ["image", "other", "xmlhttprequest"]
    }
  };
}

function addRefererRule(imageUrl, pageUrl, callback) {
  getNextRuleId(function (ruleId) {
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
        callback(ruleId);
      }
    );
  });
}

function removeRefererRule(ruleId) {
  if (!ruleId) {
    return;
  }

  chrome.declarativeNetRequest.updateSessionRules({
    addRules: [],
    removeRuleIds: [ruleId]
  });
}

function cleanupOnDownloadStart(imageUrl, ruleId) {
  var timeoutId = null;

  function done() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    chrome.downloads.onCreated.removeListener(onCreated);
    removeRefererRule(ruleId);
  }

  function onCreated(item) {
    if (item && item.url === imageUrl) {
      done();
    }
  }

  chrome.downloads.onCreated.addListener(onCreated);
  timeoutId = setTimeout(done, 5000);
}

chrome.browserAction.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) {
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

  addRefererRule(imageUrl, pageUrl, function (ruleId) {
    cleanupOnDownloadStart(imageUrl, ruleId);

    chrome.downloads.download({
      url: imageUrl,
      filename: inferFilename(imageUrl)
    });
  });
});

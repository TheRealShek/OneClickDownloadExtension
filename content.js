(function () {
  "use strict";

  function parseNumber(value) {
    if (!value) {
      return 0;
    }
    var n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function getImgFallbackSize(img) {
    var widthAttr = parseNumber(img.getAttribute("width"));
    var heightAttr = parseNumber(img.getAttribute("height"));

    if (widthAttr > 0 && heightAttr > 0) {
      return { width: widthAttr, height: heightAttr };
    }

    var clientWidth = parseNumber(img.clientWidth);
    var clientHeight = parseNumber(img.clientHeight);

    if (clientWidth > 0 && clientHeight > 0) {
      return { width: clientWidth, height: clientHeight };
    }

    return { width: 0, height: 0 };
  }

  function getImgSize(img) {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    return getImgFallbackSize(img);
  }

  function areaFromSize(size) {
    return size.width * size.height;
  }

  function normalizeUrl(url) {
    if (!url) {
      return "";
    }
    try {
      return new URL(url, document.baseURI).href;
    } catch (err) {
      return "";
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) {
      return [];
    }

    return srcset
      .split(",")
      .map(function (entry) {
        var parts = entry.trim().split(/\s+/);
        var url = parts[0];
        var descriptor = parts[1] || "";
        return { url: url, descriptor: descriptor };
      })
      .filter(function (item) {
        return item.url;
      });
  }

  function estimateAreaFromDescriptor(descriptor, baseSize) {
    if (!descriptor) {
      return 0;
    }

    var wMatch = descriptor.match(/^(\d+)w$/);
    if (wMatch) {
      var w = parseInt(wMatch[1], 10);
      if (baseSize.height > 0) {
        return w * baseSize.height;
      }
      return w * w;
    }

    var xMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/);
    if (xMatch && baseSize.width > 0 && baseSize.height > 0) {
      var scale = parseFloat(xMatch[1]);
      var width = Math.round(baseSize.width * scale);
      var height = Math.round(baseSize.height * scale);
      return width * height;
    }

    return 0;
  }

  function collectSourceCandidates(picture, baseSize) {
    var sources = Array.from(picture.querySelectorAll("source"));
    var candidates = [];

    sources.forEach(function (source) {
      var entries = parseSrcset(source.getAttribute("srcset"));
      entries.forEach(function (entry) {
        var area = estimateAreaFromDescriptor(entry.descriptor, baseSize);
        candidates.push({ url: entry.url, area: area });
      });
    });

    return candidates;
  }

  function collectImgSrcsetCandidates(img, baseSize) {
    var entries = parseSrcset(img.getAttribute("srcset"));
    return entries.map(function (entry) {
      var area = estimateAreaFromDescriptor(entry.descriptor, baseSize);
      return { url: entry.url, area: area };
    });
  }

  function findLargestImage() {
    var images = Array.from(document.images || []);
    var best = { url: "", area: 0 };

    images.forEach(function (img) {
      var size = getImgSize(img);
      var imgArea = areaFromSize(size);
      var imgUrl = normalizeUrl(img.currentSrc || img.src);

      if (imgUrl && imgArea > best.area) {
        best = { url: imgUrl, area: imgArea };
      }

      var picture = img.closest("picture");
      var baseSize = size.width > 0 && size.height > 0 ? size : getImgFallbackSize(img);

      if (picture) {
        var sourceCandidates = collectSourceCandidates(picture, baseSize);
        sourceCandidates.forEach(function (candidate) {
          var candidateUrl = normalizeUrl(candidate.url);
          var candidateArea = candidate.area || imgArea;
          if (candidateUrl && candidateArea > best.area) {
            best = { url: candidateUrl, area: candidateArea };
          }
        });
      }

      var imgSrcsetCandidates = collectImgSrcsetCandidates(img, baseSize);
      imgSrcsetCandidates.forEach(function (candidate) {
        var candidateUrl = normalizeUrl(candidate.url);
        var candidateArea = candidate.area || imgArea;
        if (candidateUrl && candidateArea > best.area) {
          best = { url: candidateUrl, area: candidateArea };
        }
      });
    });

    return best.url;
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "scan-largest-image") {
      return;
    }

    var url = findLargestImage();
    if (url) {
      chrome.runtime.sendMessage({
        type: "largest-image",
        imageUrl: url,
        pageUrl: window.location.href
      });
    }

    sendResponse({ ok: Boolean(url) });
  });
})();

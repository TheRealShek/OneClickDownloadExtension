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

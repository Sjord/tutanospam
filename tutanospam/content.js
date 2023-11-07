(function () {
    "use strict";
    console.log("TutaNoSpam: Loading...");

    const script = document.createElement('script');
    script.setAttribute('src', chrome.runtime.getURL('page.js'));
    document.body.appendChild(script);
})();

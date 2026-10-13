// OpenSight marketing site — tiny progressive enhancement.
// No framework, no external requests. Reveal-on-scroll only.
(function () {
  'use strict';

  // Reveal sections/cards as they enter the viewport.
  var els = document.querySelectorAll('.card, .compat-grid > div, .terminal, .oss-inner');
  els.forEach(function (el) { el.classList.add('reveal'); });

  if (!('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  els.forEach(function (el) { io.observe(el); });

  // If the hero video has no playable source (e.g. not yet published),
  // swap in the tour GIF so the hero never shows an empty player.
  var video = document.querySelector('.hero-video');
  if (video) {
    var sources = video.querySelectorAll('source');
    var playable = Array.prototype.some.call(sources, function (s) {
      var type = s.getAttribute('type');
      return type && video.canPlayType(type) !== '';
    });
    if (!playable || sources.length === 0) {
      var img = document.createElement('img');
      img.src = 'assets/opensight-tour.gif';
      img.alt = 'OpenSight tour: a dashboard, natural-language Q answering revenue by region, saved drafts, data preparation, connectors, and administration';
      img.style.width = '100%';
      video.replaceWith(img);
    }
  }
})();

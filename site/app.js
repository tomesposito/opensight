// OpenSight marketing site — tiny progressive enhancement.
// No framework. Hosted access is sent only on an explicit form submission.
(function () {
  'use strict';

  var form = document.querySelector('#access-request-form');
  if (form) {
    var button = form.querySelector('button[type="submit"]');
    var success = document.querySelector('#access-success');
    var error = document.querySelector('#access-error');
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      success.hidden = true;
      error.hidden = true;
      try {
        var fields = new FormData(form);
        var body = { name: fields.get('name').trim(), email: fields.get('email').trim() };
        ['organization', 'note'].forEach(function (key) {
          var value = fields.get(key).trim();
          if (value) body[key] = value;
        });
        var response = await fetch('https://app.getopensight.org/api/access-requests', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'omit', body: JSON.stringify(body)
        });
        if (response.status !== 201) throw new Error('Access request was not received');
        form.reset();
        success.hidden = false;
      } catch (_) {
        error.hidden = false;
      } finally {
        button.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
    // Keep submission disabled until the JSON handler is attached.
    button.disabled = false;
  }

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

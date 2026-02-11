(function(){

  /* -------------------------------------------------
   * IMAGE LIGHTBOX
   * ------------------------------------------------- */

  const lightbox     = document.getElementById('lightbox');
  const lightboxImg  = document.getElementById('lightbox-img');
  const lightboxExit = document.getElementById('lightbox-close');

  if (lightbox && lightboxImg) {

    const thumbs = document.querySelectorAll('.thumb, .swatch-thumb');

    thumbs.forEach(t => {
      t.addEventListener('click', () => {
        const full = (t.dataset && t.dataset.full) ? t.dataset.full : t.src;
        if (!full) return;

        lightboxImg.src = full;
        lightbox.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      });
    });

    function hideLightbox(){
      lightbox.style.display = 'none';
      lightboxImg.src = '';
      document.body.style.overflow = '';
    }

    if (lightboxExit) lightboxExit.addEventListener('click', hideLightbox);

    lightbox.addEventListener('click', e => {
      if (e.target === lightbox) hideLightbox();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideLightbox();
    });
  }



  /* -------------------------------------------------
   * 3D FULLSCREEN MODAL
   * ------------------------------------------------- */

  const inlineViewer  = document.getElementById('viewerInline');
  const openBtn       = document.getElementById('open3dFullscreen');
  const modal         = document.getElementById('modal3d');
  const modalContent  = document.getElementById('modal3dContent');
  const closeBtn      = document.getElementById('close3dFullscreen');
  const backdrop      = document.getElementById('modal3dBackdrop');

  if (inlineViewer && openBtn && modal && modalContent) {

    let clonedIframe = null;
    let lastFocus    = null;

    function openModal3D(){
      const srcIframe = inlineViewer.querySelector('iframe');
      if (!srcIframe) return;

      lastFocus = document.activeElement;

      // clone iframe so fullscreen mirrors inline view
      clonedIframe = srcIframe.cloneNode(true);
      clonedIframe.setAttribute('loading', 'eager');

      modalContent.innerHTML = '';
      modalContent.appendChild(clonedIframe);

      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      if (closeBtn) closeBtn.focus();
    }

    function closeModal3D(){
      modal.setAttribute('aria-hidden', 'true');
      modalContent.innerHTML = '';
      clonedIframe = null;

      document.body.style.overflow = '';

      if (lastFocus && typeof lastFocus.focus === 'function') {
        lastFocus.focus();
      }
    }

    openBtn.addEventListener('click', openModal3D);
    if (closeBtn)  closeBtn.addEventListener('click', closeModal3D);
    if (backdrop)  backdrop.addEventListener('click', closeModal3D);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeModal3D();
      }
    });
  }

})();
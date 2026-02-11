document.addEventListener("DOMContentLoaded", function(){

  /* ---------------------------
   * ELEMENTS
   * ------------------------- */
  const lightbox    = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxExit= document.getElementById('lightbox-close');
  const viewerCover = document.getElementById('viewerCover');
  const modal       = document.getElementById('modal3d');
  const modalContent= document.getElementById('modal3dContent');
  const closeBtn    = document.getElementById('close3dFullscreen');
  const backdrop    = document.getElementById('modal3dBackdrop');
  const openBtn     = document.getElementById('open3dFullscreen');
  const inlineViewer= document.getElementById('viewerInline');

  let clonedIframe = null;
  let lastFocus    = null;

  const thumbs = document.querySelectorAll('.thumb, .swatch-thumb');


  /* ---------------------------
   * LIGHTBOX
   * ------------------------- */

  function showLightbox(fullSrc){
    // ALWAYS close modal 3D before lightbox opens:
    if (modal.getAttribute('aria-hidden') === 'false'){
      closeModal3D();
    }

    lightboxImg.src = fullSrc;
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // COVER inline viewer during lightbox
    if (viewerCover) viewerCover.style.display = 'block';
  }

  function hideLightbox(){
    lightbox.style.display = 'none';
    lightboxImg.src = '';
    document.body.style.overflow = '';

    // UNCOVER inline viewer
    if (viewerCover) viewerCover.style.display = 'none';
  }

  thumbs.forEach(t => {
    t.addEventListener('click', () => {
      const full = t.dataset.full || t.src;
      showLightbox(full);
    });
  });

  lightboxExit?.addEventListener('click', hideLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) hideLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideLightbox(); });



  /* ---------------------------
   * FULLSCREEN 3D VIEWER
   * ------------------------- */

  function openModal3D(){
    const srcIframe = inlineViewer.querySelector('iframe');
    if (!srcIframe) return;

    lastFocus = document.activeElement;

    clonedIframe = srcIframe.cloneNode(true);
    clonedIframe.setAttribute('loading','eager');

    modalContent.innerHTML = '';
    modalContent.appendChild(clonedIframe);

    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal3D(){
    modal.setAttribute('aria-hidden','true');
    modalContent.innerHTML = '';
    clonedIframe = null;

    document.body.style.overflow = '';

    // Hide cover if shown
    if (viewerCover) viewerCover.style.display = 'none';

    if (lastFocus && typeof lastFocus.focus === 'function'){
      lastFocus.focus();
    }
  }

  openBtn?.addEventListener('click', openModal3D);
  closeBtn?.addEventListener('click', closeModal3D);
  backdrop?.addEventListener('click', closeModal3D);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false'){
      closeModal3D();
    }
  });

});
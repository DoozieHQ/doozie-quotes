document.addEventListener("DOMContentLoaded", function(){

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
    if (modal.getAttribute('aria-hidden') === 'false') {
      closeModal3D();
    }
    lightboxImg.src = fullSrc;
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (viewerCover) viewerCover.style.display = 'block';
  }

  function hideLightbox(){
    lightbox.style.display = 'none';
    lightboxImg.src = '';
    document.body.style.overflow = '';

    if (viewerCover) viewerCover.style.display = 'none';
  }

  thumbs.forEach(t => {
    t.addEventListener('click', () => {
      showLightbox(t.dataset.full || t.src);
    });
  });

  lightboxExit?.addEventListener('click', hideLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) hideLightbox(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideLightbox();
  });

  /* ---------------------------
   * FULLSCREEN 3D VIEWER
   * ------------------------- */

  // Create a FAB mask for fullscreen (covers bottom-right viewer FAB)
  function createFullscreenMask() {
    const mask = document.createElement('div');
    mask.style.position = 'absolute';
    mask.style.bottom = '0';
    mask.style.right = '0';
    mask.style.width = '80px';   // generous coverage
    mask.style.height = '80px';
    mask.style.background = 'white'; // matches modal background
    mask.style.pointerEvents = 'none';
    mask.style.zIndex = '2';      // above iframe, below close button
    return mask;
  }

  function openModal3D(){
    const srcIframe = inlineViewer.querySelector('iframe');
    if (!srcIframe) return;

    lastFocus = document.activeElement;

    // Clone iframe
    clonedIframe = srcIframe.cloneNode(true);
    clonedIframe.setAttribute('loading','eager');

    // Clear previous modal content
    modalContent.innerHTML = '';

    // Insert iframe
    modalContent.appendChild(clonedIframe);

    // Insert FAB mask over iframe
    modalContent.appendChild(createFullscreenMask());

    // Open modal
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal3D(){
    modal.setAttribute('aria-hidden','true');
    modalContent.innerHTML = '';
    clonedIframe = null;

    document.body.style.overflow = '';

    if (viewerCover) viewerCover.style.display = 'none';

    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  openBtn?.addEventListener('click', openModal3D);
  closeBtn?.addEventListener('click', closeModal3D);
  backdrop?.addEventListener('click', closeModal3D);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal3D();
    }
  });

});
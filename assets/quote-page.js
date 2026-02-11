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

  thumbs.forEach(t => t.addEventListener('click', () => {
    showLightbox(t.dataset.full || t.src);
  }));

  lightboxExit?.addEventListener('click', hideLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) hideLightbox(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideLightbox();
  });


  /* ---------------------------
   * FULLSCREEN 3D VIEWER
   * ------------------------- */

  // Create FAB-style close button for fullscreen viewer
  function createCloseFab() {
    const btn = document.createElement('button');
    btn.innerText = "×";
    btn.setAttribute('aria-label', 'Close 3D Viewer');
    btn.style.position = 'absolute';
    btn.style.bottom = '4px';
    btn.style.right = '4px';
    btn.style.width = '54px';
    btn.style.height = '54px';
    btn.style.borderRadius = '50%';
    btn.style.border = '1px solid var(--mid)';
    btn.style.background = 'var(--white)';
    btn.style.color = 'var(--black)';
    btn.style.fontSize = '28px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = '6';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    btn.style.transition = 'border-color .2s ease, box-shadow .2s ease, transform .1s ease';
    btn.style.fontFamily = 'inherit';
    btn.addEventListener('click', closeModal3D);
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--black)';
      btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'var(--mid)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    });
    btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.97)');
    btn.addEventListener('mouseup', () => btn.style.transform = 'scale(1)');

    return btn;
  }

  function openModal3D(){
    const srcIframe = inlineViewer.querySelector('iframe');
    if (!srcIframe) return;

    lastFocus = document.activeElement;

    clonedIframe = srcIframe.cloneNode(true);
    clonedIframe.setAttribute('loading','eager');

    modalContent.innerHTML = '';

    // Place iframe
    modalContent.appendChild(clonedIframe);

    // Add FAB-style close button
    modalContent.appendChild(createCloseFab());

    // Hide native close button in template (top-right)
    if (closeBtn) closeBtn.style.display = 'none';

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
  backdrop?.addEventListener('click', closeModal3D);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal3D();
    }
  });

});
document.addEventListener("DOMContentLoaded", function(){

  /* ------------------------------------------------
   * LIGHTBOX for images (thumbnails & swatches)
   * ------------------------------------------------ */
  const lightbox    = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxExit= document.getElementById('lightbox-close');
  const viewerCover = document.getElementById('viewerCover');

  function showLightbox(fullSrc){
    lightboxImg.src = fullSrc || '';
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

  // Bind to image thumbnails and swatches
  document.querySelectorAll('.thumb, .swatch-thumb').forEach(img => {
    img.addEventListener('click', (e) => {
      const full = img.getAttribute('data-full') || img.getAttribute('src');
      if (full) showLightbox(full);
    });
  });
  lightboxExit?.addEventListener('click', hideLightbox);
  lightbox?.addEventListener('click', (e) => { if (e.target === lightbox) hideLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideLightbox(); });


  /* ------------------------------------------------
   * FULLSCREEN 3D VIEWER — multi-instance, defensive
   * ------------------------------------------------ */
  const modal        = document.getElementById('modal3d');
  const modalContent = document.getElementById('modal3dContent');
  const backdrop     = document.getElementById('modal3dBackdrop');
  const templateCloseBtn = document.getElementById('close3dFullscreen');

  let clonedIframe = null;
  let lastFocus    = null;

  function createCloseFab() {
    const btn = document.createElement('button');
    btn.innerText = "✕";
    btn.setAttribute('aria-label', 'Close 3D Viewer');

    Object.assign(btn.style, {
      position: 'absolute',
      bottom: '4px',
      right: '4px',
      width: '54px',
      height: '54px',
      borderRadius: '50%',
      border: '1px solid var(--mid)',
      background: 'var(--white)',
      color: 'var(--black)',
      fontSize: '26px',
      lineHeight: '1',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '6',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      transition: 'border-color .2s ease, box-shadow .2s ease, transform .1s ease',
      fontFamily: 'inherit'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--black)';
      btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'var(--mid)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    });
    btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.97)');
    btn.addEventListener('mouseup',   () => btn.style.transform = 'scale(1)');
    btn.addEventListener('click', closeModal3D);

    return btn;
  }

  function openModal3DFor(viewerWrap){
    if (!viewerWrap) return;
    const inlineContainer = viewerWrap.querySelector('.js-viewer-inline');
    const srcIframe = inlineContainer?.querySelector('iframe');
    if (!srcIframe) return;

    lastFocus = document.activeElement;

    clonedIframe = srcIframe.cloneNode(true);
    clonedIframe.setAttribute('loading','eager');

    modalContent.innerHTML = '';
    modalContent.appendChild(clonedIframe);
    modalContent.appendChild(createCloseFab());

    if (templateCloseBtn) templateCloseBtn.style.display = 'none';

    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal3D(){
    modal.setAttribute('aria-hidden','true');
    modalContent.innerHTML = '';
    clonedIframe = null;

    document.body.style.overflow = '';
    if (viewerCover) viewerCover.style.display = 'none';

    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  // Primary binding: explicit class
  document.querySelectorAll('.js-open3d').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.js-viewer');
      openModal3DFor(wrap);
    });
  });

  // Defensive fallback: any .fab-3d inside a .js-viewer
  document.querySelectorAll('.js-viewer .fab-3d').forEach(btn => {
    if (!btn.classList.contains('js-open3d')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wrap = btn.closest('.js-viewer');
        openModal3DFor(wrap);
      });
    }
  });

  // Backdrop & ESC close
  backdrop?.addEventListener('click', closeModal3D);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
      closeModal3D();
    }
  });

});
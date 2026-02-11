document.addEventListener("DOMContentLoaded", function(){

  /* ----------------------------------------------
   * LIGHTBOX LOGIC (unchanged)
   * ---------------------------------------------- */

  const lightbox    = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxExit= document.getElementById('lightbox-close');
  const viewerCover = document.getElementById('viewerCover');
  const modal       = document.getElementById('modal3d');
  const modalContent= document.getElementById('modal3dContent');
  const backdrop    = document.getElementById('modal3dBackdrop');
  const templateCloseBtn = document.getElementById('close3dFullscreen');

  let clonedIframe = null;
  let lastFocus = null;

  const thumbs = document.querySelectorAll('.thumb, .swatch-thumb');

  function showLightbox(fullSrc){
    if (modal.getAttribute('aria-hidden') === 'false'){
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
    t.addEventListener('click', () => showLightbox(t.dataset.full || t.src));
  });

  lightboxExit?.addEventListener('click', hideLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) hideLightbox(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideLightbox();
  });


  /* -------------------------------------------------------------
   * FULLSCREEN 3D VIEWER — MULTI INSTANCE SUPPORT (v56)
   * ------------------------------------------------------------- */

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
    btn.addEventListener('mouseup', () => btn.style.transform = 'scale(1)');

    btn.addEventListener('click', closeModal3D);
    return btn;
  }

  function openModal3DFor(viewerWrap){
    const iframe = viewerWrap.querySelector('.js-viewer-inline iframe');
    if (!iframe) return;

    lastFocus = document.activeElement;

    clonedIframe = iframe.cloneNode(true);
    clonedIframe.setAttribute('loading', 'eager');

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
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.querySelectorAll('.js-open3d').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewerWrap = btn.closest('.js-viewer');
      if (viewerWrap) openModal3DFor(viewerWrap);
    });
  });

  backdrop?.addEventListener('click', closeModal3D);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false'){
      closeModal3D();
    }
  });

});
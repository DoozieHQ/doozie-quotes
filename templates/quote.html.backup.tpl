<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{{PROJECT_TITLE}} — Quote (Lead {{LEAD_ID}})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <base href="/"/>

  <!-- Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>

  <style>
    :root{
      --black:#101010;
      --grey:#555;
      --mid:#e5e5e5;
      --light:#f9f9f9;
      --white:#ffffff;
      --accent:#ffc700;

      --page-width:1000px;
      --rounded:16px;
      --font:"Poppins", -apple-system, BlinkMacSystemFont, sans-serif;
    }

    *{box-sizing:border-box;margin:0;padding:0;}
    body{
      font-family:var(--font);
      background:var(--white);
      color:var(--black);
      -webkit-font-smoothing:antialiased;
    }

    /* ------------------------------ HEADER ------------------------------ */
    .header{width:100%;background:var(--light);border-bottom:1px solid var(--mid);}
    .header-inner{max-width:var(--page-width);margin:auto;padding:22px 28px;display:flex;justify-content:space-between;align-items:center;}
    .header-left{display:flex;align-items:center;gap:20px;}
    .header-left img.logo{height:50px;object-fit:contain;}
    .rev-badge{background:var(--white);border:1px solid var(--mid);border-radius:999px;padding:6px 18px;font-size:0.9rem;font-weight:600;}

    /* ------------------------------ WRAP ------------------------------ */
    .wrap{max-width:var(--page-width);margin:40px auto 80px;padding:0 28px;}

    /* ------------------------------ TITLES ------------------------------ */
    .title-block{margin-bottom:32px;}
    .title{font-size:2.4rem;font-weight:600;line-height:1.2;margin-bottom:8px;}

    /* ------------------------------ SECTIONS ------------------------------ */
    .section{border:1px solid var(--mid);border-radius:var(--rounded);background:var(--white);padding:28px;margin-bottom:30px;box-shadow:0 4px 16px rgba(0,0,0,0.05);}
    .section h2{font-size:1.4rem;font-weight:600;margin-bottom:18px;}
    .meta-grid{display:grid;grid-template-columns:140px 1fr;row-gap:10px;font-size:0.95rem;color:var(--grey);}

    /* ------------------------------ QUOTE DETAILS ------------------------------ */
    .meta-2col{display:grid;grid-template-columns:1fr 1fr;gap:28px;}
    .meta-label{font-weight:600;font-size:0.95rem;margin-bottom:4px;}
    .meta-value{color:var(--grey);font-size:0.95rem;line-height:1.4;}
    .meta-value a{color:var(--black);text-decoration:none;border-bottom:1px solid var(--mid);}
    .meta-value a:hover{border-bottom-color:var(--black);}

    /* ------------------------------ MAIN THUMBNAILS ------------------------------ */
    .gallery{display:grid;grid-template-columns:1fr;gap:20px;margin-top:14px;}
    @media(min-width:700px){.gallery{grid-template-columns:1fr 1fr;}}
    .thumb{width:100%;height:260px;object-fit:cover;border-radius:var(--rounded);border:1px solid var(--mid);cursor:pointer;transition:.25s ease;}
    .thumb:hover{transform:scale(1.02);box-shadow:0 10px 20px rgba(0,0,0,0.15);}
    .thumb-caption{text-align:center;margin-top:8px;font-size:0.9rem;color:var(--grey);}

    /* ------------------------------ 3D VIEWER ------------------------------ */
    .viewer{margin-top:16px;border-radius:var(--rounded);border:1px solid var(--mid);overflow:hidden;position:relative;aspect-ratio:16/9;background:#000;}
    .viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}

    /* ------------------------------ SWATCHES ------------------------------ */
    .subhead{font-size:1.1rem;font-weight:600;margin-top:26px;margin-bottom:8px;display:flex;align-items:center;gap:10px;}
    .subhead-line{height:2px;background:var(--accent);width:60px;border-radius:2px;}
    .swatch-grid{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:18px;}
    @media(min-width:720px){.swatch-grid{grid-template-columns:repeat(4,1fr);}}
    .swatch-card{background:var(--white);border:1px solid var(--mid);border-radius:var(--rounded);padding:14px;box-shadow:0 4px 12px rgba(0,0,0,0.05);}
    .swatch-thumb{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;border:1px solid var(--mid);cursor:pointer;transition:.25s ease;}
    .swatch-thumb:hover{transform:scale(1.03);}
    .swatch-caption{margin-top:10px;font-size:0.9rem;color:var(--grey);line-height:1.35;}

    /* ------------------------------ PRICING ------------------------------ */
    table{width:100%;border-collapse:collapse;margin-top:10px;}
    th{background:var(--light);text-align:left;padding:12px;border-bottom:1px solid var(--mid);font-size:0.95rem;font-weight:600;}
    td{padding:12px;border-bottom:1px solid var(--mid);font-size:0.95rem;}
    .num{text-align:right;}
    tfoot td{font-weight:600;}
    .total-row td{font-size:1.15rem;font-weight:700;}

    /* ------------------------------ LIGHTBOX ------------------------------ */
    .lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:9999;justify-content:center;align-items:center;}
    .lightbox img{max-width:90%;max-height:90%;border-radius:var(--rounded);box-shadow:0 10px 40px rgba(0,0,0,0.6);}
    .lightbox-close{position:absolute;top:24px;right:36px;font-size:40px;font-weight:200;color:white;cursor:pointer;}

    /* ------------------------------ FOOTER ------------------------------ */
    .footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--mid);text-align:center;font-size:0.85rem;color:var(--grey);}
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <img class="logo" src="assets/logo.png" alt="Doozie logo"/>
      </div>
      <div class="rev-badge">Quote {{LEAD_ID}} – Rev {{REVISION}}</div>
    </div>
  </div>

  <div class="wrap">

    <!-- TITLE BLOCK -->
    <div class="title-block">
      <div class="title">{{PROJECT_TITLE}}</div>
    </div>

    <!-- QUOTE DETAILS (two-column) -->
    <div class="section">
      <h2>Quote Details</h2>

      <div class="meta-2col">
        <div>
          <div class="meta-label">From:</div>
          <div class="meta-value">
            Ed Cawthorne<br/>
            Doozie Ltd<br/>
            <a href="https://www.doozie.co" target="_blank" rel="noopener">www.doozie.co</a><br/>
            Phone: 07890561683
          </div>
        </div>

        <div>
          <div class="meta-label">For:</div>
          <div class="meta-value">{{CLIENT_NAME}}</div>

          <div class="meta-label" style="margin-top:14px;">Date Issued:</div>
          <div class="meta-value">{{ISSUE_DATE}}</div>

          <div class="meta-label" style="margin-top:14px;">Expiring Date:</div>
          <div class="meta-value">{{EXPIRY_DATE}}</div>
        </div>
      </div>
    </div>

    <!-- OVERVIEW -->
    <div class="section">
      <h2>Overview</h2>
      <p style="color:var(--grey);margin-bottom:20px;">{{OVERVIEW_TEXT}}</p>
    </div>

    <!-- MAIN IMAGES -->
    <div class="section">
      <h2>Main Views</h2>
      <p class="subnote" style="color:var(--grey);font-size:0.9rem;">Tap to view full size</p>

      <div class="gallery">
        <div>
          <img
            class="thumb"
            src="{{IMAGE_DOORSON_THUMB}}"
            data-full="{{IMAGE_DOORSON_THUMB}}"
            alt="Front view — doors on"
          />
          <div class="thumb-caption">Front view — doors on</div>
        </div>

        <div>
          <img
            class="thumb"
            src="{{IMAGE_DOORSOFF_THUMB}}"
            data-full="{{IMAGE_DOORSOFF_THUMB}}"
            alt="Front view — doors removed"
          />
          <div class="thumb-caption">Front view — doors removed</div>
        </div>
      </div>
    </div>

    <!-- 3D VIEWER -->
    <div class="section">
      <h2>3D Visualisation</h2>
      <p style="color:var(--grey);font-size:0.9rem;margin-bottom:10px;">Rotate, zoom and pan to explore the model.</p>
      <div class="viewer">
        {{THREED_IFRAME_URL}}
      </div>
    </div>

    <!-- MATERIALS & HANDLES -->
    <div class="section">
      <h2>Materials & Hardware</h2>

      <div class="subhead">Materials <div class="subhead-line"></div></div>
      <div class="swatch-grid">
        <figure class="swatch-card">
          <img
            class="swatch-thumb"
            src="{{MATERIAL_1_THUMB}}"
            data-full="{{MATERIAL_1_THUMB}}"
            alt="{{MATERIAL_1_NAME}}"
          />
          <figcaption class="swatch-caption">
            <strong>{{MATERIAL_1_NAME}}</strong><br/>
            <span>{{MATERIAL_1_NOTES}}</span>
          </figcaption>
        </figure>

        {{MATERIAL_2_BLOCK}}
      </div>

      <div class="subhead" style="margin-top:30px;">Handles <div class="subhead-line"></div></div>
      <div class="swatch-grid">
        {{HANDLE_1_BLOCK}}
        {{HANDLE_2_BLOCK}}
      </div>
    </div>

    <!-- PRICING -->
    <div class="section">
      <h2>Investment Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th>
          </tr>
        </thead>
        <tbody>
          {{LINE_ITEMS_HTML}}
        </tbody>
        <tfoot>
          <tr><td colspan="3" class="num">Subtotal</td><td class="num">{{CURRENCY}}{{SUBTOTAL}}</td></tr>
          <tr><td colspan="3" class="num">VAT (20%)</td><td class="num">{{CURRENCY}}{{VAT_AMOUNT}}</td></tr>
          <tr class="total-row"><td colspan="3" class="num">Total</td><td class="num">{{CURRENCY}}{{TOTAL}}</td></tr>
        </tfoot>
      </table>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      © 2026 • YOUR_COMPANY_NAME • YOUR_COMPANY_ADDRESS • SALES_EMAIL
    </div>

  </div>

  <!-- LIGHTBOX -->
  <div class="lightbox" id="lightbox">
    <span class="lightbox-close" id="lightbox-close">&times;</span>
    <img id="lightbox-img" src="" alt="">
  </div>

  <script>
    (function(){
      const box  = document.getElementById('lightbox');
      const img  = document.getElementById('lightbox-img');
      const exit = document.getElementById('lightbox-close');

      const thumbs = document.querySelectorAll('.thumb, .swatch-thumb');

      thumbs.forEach(t => {
        t.addEventListener('click', () => {
          const full = t.dataset.full || t.src;
          img.src = full;
          box.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        });
      });

      function hide(){
        box.style.display = 'none';
        img.src = '';
        document.body.style.overflow = '';
      }

      exit.addEventListener('click', hide);
      box.addEventListener('click', e => { if (e.target === box) hide(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    })();
  </script>

</body>
</html>
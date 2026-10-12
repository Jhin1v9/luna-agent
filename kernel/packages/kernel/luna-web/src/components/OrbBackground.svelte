<script>
  import { onMount, onDestroy } from 'svelte';

  let canvas;
  let ctx;
  let animationId;
  let w, h;
  let orbs = [];
  let particles = [];
  let gridOffset = 0;

  const ORB_COUNT = 5;
  const PARTICLE_COUNT = 80;
  const CONNECTION_DIST = 120;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function initOrbs() {
    orbs = [];
    const colors = ['#7c3aed', '#22d3ee', '#34d399', '#e94560', '#a78bfa'];
    for (let i = 0; i < ORB_COUNT; i++) {
      orbs.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 60 + Math.random() * 140,
        dx: (Math.random() - 0.5) * 0.3,
        dy: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length],
        opacity: 0.08 + Math.random() * 0.1,
      });
    }
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.5,
      });
    }
  }

  function drawGrid() {
    const gridSize = 60;
    const offset = gridOffset % gridSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.015)';
    ctx.lineWidth = 1;

    for (let x = -offset; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = -offset; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function drawOrbs() {
    for (const orb of orbs) {
      const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      gradient.addColorStop(0, orb.color + Math.floor(orb.opacity * 255).toString(16).padStart(2, '0'));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
      ctx.fill();

      // Move
      orb.x += orb.dx;
      orb.y += orb.dy;
      if (orb.x < -orb.r) orb.x = w + orb.r;
      if (orb.x > w + orb.r) orb.x = -orb.r;
      if (orb.y < -orb.r) orb.y = h + orb.r;
      if (orb.y > h + orb.r) orb.y = -orb.r;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;

      ctx.fillStyle = `rgba(160, 200, 255, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw connections
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          ctx.globalAlpha = (1 - dist / CONNECTION_DIST) * 0.3;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, w, h);
    drawGrid();
    drawOrbs();
    drawParticles();
    gridOffset += 0.2;
    animationId = requestAnimationFrame(animate);
  }

  function handleResize() {
    resize();
    initOrbs();
    initParticles();
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resize();
    initOrbs();
    initParticles();
    animate();
    window.addEventListener('resize', handleResize);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', handleResize);
  });
</script>

<canvas bind:this={canvas} class="orb-canvas"></canvas>

<style>
  .orb-canvas {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    pointer-events: none;
  }
</style>

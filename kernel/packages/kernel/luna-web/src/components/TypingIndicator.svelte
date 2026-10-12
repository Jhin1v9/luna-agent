<script>
  import { Moon } from 'lucide-svelte';

  export let text = 'Luna está pensando';
</script>

<div class="typing-indicator">
  <div class="typing-avatar"><Moon size={16} strokeWidth={1.5} color="#fff" /></div>
  <div class="typing-bubble">
    <span class="typing-text">{text}</span>
    <span class="typing-dots">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </span>
  </div>
</div>

<style>
  .typing-indicator {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0;
    animation: fadeIn 0.3s ease;
  }

  .typing-avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    flex-shrink: 0;
  }

  .typing-bubble {
    background: var(--card-bg, rgba(30, 30, 46, 0.7));
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    border-radius: 1rem;
    border-top-left-radius: 0.25rem;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    backdrop-filter: blur(12px);
  }

  .typing-text {
    font-size: 0.875rem;
    color: var(--text-muted, #a0a0b0);
  }

  .typing-dots {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary, #b388ff);
    animation: bounce 1.4s infinite ease-in-out both;
  }

  .dot:nth-child(1) {
    animation-delay: -0.32s;
  }

  .dot:nth-child(2) {
    animation-delay: -0.16s;
  }

  @keyframes bounce {
    0%, 80%, 100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>

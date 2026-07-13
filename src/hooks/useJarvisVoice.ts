import { useState, useEffect, useCallback, useRef } from "react";

export function useJarvisVoice() {
  const [isMuted, setIsMuted] = useState(true);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const lastSpokenRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!synth) return;

    const handleVoicesChanged = () => {
      setVoicesLoaded(true);
    };

    if (synth.getVoices().length > 0) {
      setVoicesLoaded(true);
    }

    synth.addEventListener("voiceschanged", handleVoicesChanged);
    return () => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
    };
  }, [synth]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (!next && synth) {
        // Play a short sound to unlock AudioContext on user interaction
        const utterance = new SpeechSynthesisUtterance("Voice assistant activated.");
        utterance.volume = 0.5;
        synth.speak(utterance);
      } else if (next && synth) {
        synth.cancel();
      }
      return next;
    });
  }, [synth]);

  const speak = useCallback((text: string, category: string = "general", cooldownMs: number = 15000) => {
    if (isMuted || !synth) return;

    const now = Date.now();
    const lastSpoken = lastSpokenRef.current[category] || 0;

    // Throttle repeated messages of the same category
    if (now - lastSpoken < cooldownMs) {
      return;
    }

    lastSpokenRef.current[category] = now;

    // Cancel any currently speaking utterance so urgent alerts take priority
    if (category === "URGENT") {
      synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Attempt to pick a good voice (preferably Microsoft Zira, Google UK English Female, etc.)
    const voices = synth.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.includes("Google UK English Female") || 
      v.name.includes("Microsoft Zira") || 
      v.name.includes("Samantha") ||
      (v.lang.startsWith("en") && v.name.includes("Female"))
    );

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.rate = 1.05; // Slightly faster
    utterance.pitch = 1.1; // Slightly higher pitch
    utterance.volume = 1.0;

    synth.speak(utterance);
  }, [isMuted, synth]);

  return { isMuted, toggleMute, speak, voicesLoaded };
}

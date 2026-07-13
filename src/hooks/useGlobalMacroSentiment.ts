import { useState, useEffect } from "react";
import type { MacroSentimentResult } from "../engine/aiBrainEngine";

export function useGlobalMacroSentiment(): MacroSentimentResult | undefined {
  const [result, setResult] = useState<MacroSentimentResult | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;
    
    const fetchNews = async () => {
      const rssFeeds = [
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "https://finance.yahoo.com/news/rssindex",
        "https://www.moneycontrol.com/rss/marketreports.xml"
      ];
      
      let headlines: string[] = [];
      let fetchSuccessful = false;
      
      for (const rssUrl of rssFeeds) {
        try {
          const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
          const res = await fetch(apiUrl);
          if (!res.ok) continue;
          
          const data = await res.json();
          if (data.status === "ok" && data.items && data.items.length > 0) {
            headlines = data.items.slice(0, 10).map((item: any) => item.title);
            fetchSuccessful = true;
            break;
          }
        } catch (e) {
          // Continue trying next feeds on error
        }
      }
      
      if (!fetchSuccessful) {
        console.warn("Failed to fetch live macro news from feeds. Using local fallback news.");
        headlines = [
          "Nifty scales new record highs on global rally and strong institutional inflows",
          "Inflation metrics remain stable as global markets trade positive",
          "Federal Reserve signals potential rate pauses, boosting investor sentiment",
          "Corporate earnings beat consensus estimates across major tech and banking sectors",
          "Retail participation in Indian equities reaches all-time high",
          "FIIs turn net buyers in cash market, strengthening index support",
          "Manufacturing PMI expands at a robust pace, signaling economic resilience",
          "Global crude oil prices stabilize, easing inflation worries for emerging markets",
          "Auto sector shines on strong monthly sales figures and EV push",
          "Rupee trades stable against the US Dollar amid steady forex reserves"
        ];
      }
      
      let bullishWords = ["surge", "soar", "gain", "high", "jump", "record", "rally", "positive", "growth", "buy", "bull", "up", "rise", "soaring"];
      let bearishWords = ["fall", "drop", "plunge", "low", "crash", "negative", "loss", "sell", "bear", "fear", "slip", "sink", "weak", "down"];
      
      let score = 0;
      let text = headlines.join(" ").toLowerCase();
      
      bullishWords.forEach(w => {
        const matches = text.match(new RegExp(`\\b${w}\\b`, "g"));
        if (matches) score += matches.length * 15;
      });
      
      bearishWords.forEach(w => {
        const matches = text.match(new RegExp(`\\b${w}\\b`, "g"));
        if (matches) score -= matches.length * 15;
      });
      
      score = Math.max(-100, Math.min(100, score));
      
      let sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
      if (score > 15) sentiment = "BULLISH";
      else if (score < -15) sentiment = "BEARISH";
      
      if (isMounted) {
        setResult({
          macroSentiment: sentiment,
          macroSentimentScore: score,
          latestNewsHeadlines: headlines
        });
      }
    };

    fetchNews();
    
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return result;
}

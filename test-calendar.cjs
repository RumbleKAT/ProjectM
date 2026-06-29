const fs = require('fs');
const path = require('path');

const API_KEY = '7A24YQ8-MZ54DF7-Q1F102P-NR75Y09';
const API_URL = 'http://localhost:3001/api/v1/workspace/mywork/chat';

async function runTest() {
  console.log("Starting 10-iteration accuracy test for calendar generation...");
  
  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= 10; i++) {
    console.log(`\n--- Iteration ${i} / 10 ---`);
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          message: "2026년 7월 달력을 PDF 파일로 만들어줘. 7월 1일이 무슨 요일인지 반드시 생각하고 정확한 달력을 작성해.",
          mode: "chat"
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error(`API Error: ${response.status} ${response.statusText}`, data);
        failCount++;
        continue;
      }
      
      const text = data.textResponse || "";
      console.log(`[LLM Response snippet]:\n${text.substring(0, 300)}...`);
      
      // Look for evidence of <thought> tags or correct calculation
      // July 1, 2026 is a Wednesday.
      
      if (text.includes("수요일") || text.includes("Wednesday") || text.includes("PDF")) {
        console.log(`✅ Iteration ${i} succeeded! Looks like the model calculated the date correctly or generated a file.`);
        successCount++;
      } else {
        console.log(`❌ Iteration ${i} might have failed to determine the correct date.`);
        failCount++;
      }
      
      // Delay briefly between requests to not overwhelm the LLM provider
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (err) {
      console.error(`Error on iteration ${i}:`, err.message);
      failCount++;
    }
  }
  
  console.log(`\n=== Test Complete ===`);
  console.log(`Success: ${successCount}/10`);
  console.log(`Failures: ${failCount}/10`);
}

runTest();

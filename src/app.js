'use strict';
import './app.css';

(function() {
  const API_URL = 'https://us-central1-algotab-1147.cloudfunctions.net/webApi/api/v1';
  const fetchQuestions = () => {
  let result = []
  fetch(`${API_URL}/question`)
  .then(
   async function(response) {
      if (response.status !== 200) {
        console.log('Looks like there was a problem. Status Code: ' +
          response.status);
        return;
      }
        await response.json().then(function(data) {                 
        let src = data.link;
        let url = data.questionUrl;
        console.log("Below:")     
        console.log(src)
        document.getElementById('question-image').src= src;        
        var link = document.getElementById('question-btn');          
        link.addEventListener('click', function() {
          let clickSrc = `location.href=${url};`
          console.log(clickSrc)
          window.location.href=url;              
        });      
        result = data
      });     
        
    }
  )
  .catch(function(err) {
    console.log('Fetch Error', err);
  });
  return result
  }


  let data = fetchQuestions();
  console.log(data)


  chrome.runtime.sendMessage(
    {
      type: 'FETCH QUESTION',
      payload: {
        message: data,
      },
    },
    response => {
      console.log(response);
    }
  );
  
})();

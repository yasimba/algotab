const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const bodyParser  = require("body-parser");
const puppeteer  = require('puppeteer');
const devices  = require('puppeteer/DeviceDescriptors');
const moment = require('moment');
const axios = require('axios');
var cors = require('cors');

const { Storage } = require('@google-cloud/storage')
const gcs = new  Storage ({keyFilename: 'serviceAccount.json'});

admin.initializeApp(functions.config().firebase);

const app = express();
app.use(cors());
const main = express();
const bucket = gcs.bucket(process.env.storageBucketURL);



questionWorker = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {    
    /**
     * Every 5 minutes we will add a new screenshot
     * If the number of screenshots stored is greater than 100, we will reduce
     * the number of screenshots, else we add more screenshots.
     * This allows us to manage the storage like a bucket of water. This bucket should 
     * not overflow with water, nor should it be too empty.
     */
    //Each invocation times out after 60 seconds
    let db = admin.firestore();  
    let deleteCandidates = []
    let count = 0;
    let questionsRef = db.collection('questions');
    questionsRef.get()
    .then(async snapshot => {
        snapshot.forEach(doc => {
        //console.log(doc.id, '=>', doc.data());
        count += 1
        if(count <= 10){
            deleteCandidates.push(doc.id) // we do deletion in batches
        }
        });
    //add more screenshots to the database
    if(count <= 100){        
            try {     
                const response = axios.get(`${process.env.API_URL}/fetchQuestion`);
                //console.log(response);                
              } catch (error) {
                console.error(error);
              }        
    }
    else{
        //delete 10 questions at a time
        //we store each screenshot accoring to timestamp, so we can call our other function to delete and image 
        //at a specific timestamp
        deleteCandidates.forEach(timestamp => {
            try {
                const response = axios.get(`${process.env.API_URL}/deleteQuestion/${timestamp}`);
                //console.log(response);                
              } catch (error) {
                console.error(error);
              }
        })      
    }  
    return
    })
        .catch(err => {
            console.error('Error getting documents', err);
    });     
});


async function screenshotDOMElement(page, selector, padding = 0) {
    const rect = await page.evaluate(selector => {
      //find start slug of class since leetcode tries to stop scraping
      const element = document.querySelectorAll(`[class^=${selector}]`);
      return element
    }, selector);    
    return await page.screenshot({
      // we can save images in the cloud in a tmp folder
      // gcp gives us permissions to read/write from this folder
      path: '/tmp/element.png'      
    });
}

const upload = (localFile, remoteFile) => {
    let timestamp = moment().unix()
    return bucket.upload(localFile, {
          //remote file will be same filename but with the timestamp attached
          destination: remoteFile,
          uploadType: "media",
          metadata: {
            contentType: 'image/png',
            metadata: {
              firebaseStorageDownloadTokens: timestamp
            }
          }
        })
        .then((data) => {
            let file = data[0];
            return Promise.resolve("https://firebasestorage.googleapis.com/v0/b/" + bucket.name + "/o/" + encodeURIComponent(file.name) + "?alt=media&token=" + timestamp);
        }).catch(err => {
            console.error(err)
        })
  }


app.get('/deleteQuestion/:timestamp', async (req, res) => {    
    let timestamp = req.params.timestamp
    if(!timestamp || timestamp === ''){
        console.error("Unable to delete timestamp because it is Invalid")     
        res.status(400).send(`Unable to delete timestamp`)   
        return
    }
    let db = admin.firestore();    
    db.collection('questions').doc(timestamp).delete().then(
        () => {
            const filePath = `/tmp/element${timestamp}.png`    
            const file = bucket.file(filePath)    
            file.delete().then(() => {
                console.log(`Successfully deleted photo with timestamp ${timestamp}`)
                res.send(`Successfully deleted photo with timestamp ${timestamp}`)
                return
            }).catch(err => {
                console.error(`Unable to delete the photo, error: ${err}`)
                res.send(`Unable to delete the photo, error: ${err}`)
            });
           return
        }
    ).catch(
        err => {
            console.error(err)
        }
    )    
})

// send a question to the client (chrome extension, website, e.t.c)
app.get('/question', async (req, res) => {
    let db = admin.firestore();  
    let questions = []
    let idx = 0;
    let questionsRef = db.collection('questions');
    questionsRef.get()
    .then(async snapshot => {
        snapshot.forEach(doc => {
        //console.log(doc.id, '=>', doc.data());        
        questions.push(doc.data())
        })
        if(questions.length === 0){
            res.status(200).send({})
        }
        let max = questions.length - 1
        let min = 0
        idx =  Math.floor(Math.random() * (max - min + 1)) + min; // get index of a random question
        res.status(200).send(questions[idx])    
        return
}).catch(err => {
    console.error(err)
    res.status(400).send("Error occured when getting question")
});
});


app.get('/fetchQuestion', async (req, res) => {
    let questionUrl = ''
    let timestamp = moment().unix()
    try {            
        const browser = await puppeteer.launch({
            args: ['--no-sandbox']
        })
        const page = await browser.newPage()        
        await page.setViewport({
            width: 1280,
            height: 800
        })        
        await page.emulate(devices['iPhone 6'])
        await page.goto('https://leetcode.com/problemset/all/',{ waitUntil: 'networkidle2' })
        await page.evaluate(() => {
                // click the button required to fetch a random question
                let elements = document.getElementsByClassName('btn btn-default btn-md btn-action');
                for (let element of elements)
                    element.click();
        });                                
        await page.waitForNavigation({ waitUntil: 'networkidle2' })         
        const image = await screenshotDOMElement(page, 'question-description',10);        
        questionUrl = page.url();

        await browser.close()    
        //upload our screenshot to our storage bucket     
        upload('/tmp/element.png', `/tmp/element${timestamp.toString()}.png`).then( downloadURL => {
            console.log(downloadURL);
            let data = {
                link: downloadURL,
                questionUrl: questionUrl
              };  
            let db = admin.firestore();            
            console.log(timestamp)
            //upload the downloadUrl and question link to firestore
            db.collection('questions').doc(timestamp.toString()).set(data);  
            res.status(200).send({
                image: downloadURL,
                url: questionUrl
            })
            return
          }).catch(err => {
              console.error(err)
          })        
    } catch (error) {
        console.error(error)
        res.status(400).send(`Unable to fetch link`)
    }        
})


main.use('/api/v1', app);
main.use(bodyParser.json());
main.use(bodyParser.urlencoded({ extended: false }));
main.use(cors());

const webApi = functions.https.onRequest(main);
module.exports = { webApi,  questionWorker}


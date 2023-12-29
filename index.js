const express = require('express');
const app = express()
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

//middleware
app.use(cors())
app.use(express.json())


const verifyJWT =(req,res,next)=>{
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(401).send({ error: true, message: 'Unautorized Access'})
  }
// bearer token
const token = authorization.split(' ')[1];
jwt.verify(token, process.env.ACCESS_WEB_TOKEN, (error, decoded)=>{
  if(error){
    return res.status(401).send({ error: true, message: 'Unautorized Access'})
  }
  req.decoded = decoded;
  next()
})
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gny4dya.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
const menuCollection = client.db('bistroDb').collection('menu')
const reviewsCollection = client.db('bistroDb').collection('reviews')
const cartCollection = client.db('bistroDb').collection('carts')
const userCollecton = client.db('bistroDb').collection('users')
const paymentCollecton = client.db('bistroDb').collection('payments')


//warning : use verifyJWT before using verifyAdmin
const verifyAdmin = async(req, res, next)=>{
const email = req.decoded.email;
const query = {email: email}
const user = await userCollecton.findOne(query)
if(user?.role !== 'admin'){
  return res.status(403).send({ error: true, message: 'forbidden access'})
}
next()

}

app.post('/jwt', (req, res)=>{
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_WEB_TOKEN, { expiresIn: '1h' })
  res.send(token)
})

app.get('/menu', async(req, res)=>{
    const result = await menuCollection.find().toArray()
    res.send(result)
})

app.post('/menu', async(req, res)=>{
  const newItem = req.body;
  const result = await menuCollection.insertOne(newItem)
  res.send(result)
})


app.delete('/menu/:id', verifyJWT, verifyAdmin, async(req, res)=>{
  const id= req.params.id;
  const query= {_id: new ObjectId(id)}
  const result = await menuCollection.deleteOne(query)
  res.send(result)
})

app.get('/reviews', async(req, res)=>{
    const result = await reviewsCollection.find().toArray()
    res.send(result)
})

//create payment Intent
app.post('/create-payment-intent', verifyJWT, async(req, res)=>{
const {totalprice}= req.body;
const amount = totalprice * 100;
if(amount >0){
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: 'usd',
    payment_method_types: ['card']
  })
  res.send({
    clientSecret: paymentIntent.client_secret
  })
}


})

app.post('/payments', verifyJWT,async(req, res)=>{
  const payment = req.body;
  const insertresult=await paymentCollecton.insertOne(payment)
  const query = {_id: {$in: payment.cartitems.map(id => new ObjectId(id))}}
  const deleteResult = await cartCollection.deleteMany(query)
  res.send({insertresult, deleteResult})
})


//cart from user data 
app.get('/carts', verifyJWT, async(req, res)=>{
  const email= req.query.email;
  if(!email){
    res.send([])
  }
  
  const decodedEmail = req.decoded.email;
  if(email !== decodedEmail){
    return res.status(403).send({ error: true, message: 'forbidden access'})
  }

  const query = {email: email};
  const result = await cartCollection.find(query).toArray()
  res.send(result)
})

app.post('/carts', async(req, res)=>{
  const item = req.body;
  const result = await cartCollection.insertOne(item)
  res.send(result)
})


app.delete('/carts/:id', async(req, res)=>{
  const id= req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await cartCollection.deleteOne(query)
  res.send(result)
})

//user data
/*
0. do not show secure links to those whoe should not see the links
1.use jwt token: verifyJWT
3. use veryfyAdmin middleware
*/

app.get('/users', verifyJWT, verifyAdmin, async(req, res)=>{
  const result = await userCollecton.find().toArray()
  res.send(result)
})

app.post('/users', async(req, res)=>{
  const user= req.body;
  const query = {email: user.email};
  const exestingUser = await userCollecton.findOne(query)
  if(!exestingUser){
    const result = await userCollecton.insertOne(user)
    res.send(result)
  }
})

//security layer : verifyJWT
// email same
//check admin
app.get('/users/admin/:email', verifyJWT, async(req, res)=>{
  const email = req.params.email;
  if(email !== req.decoded.email){
    return res.send({admin: false})
  }

  const query = {email: email}
  const user = await userCollecton.findOne(query)
  const result ={ admin: user?.role === 'admin'}
  res.send(result)
})

app.patch('/users/admin/:id', async(req, res)=>{
  const id= req.params.id;
  const filter= {_id: new ObjectId(id)}
  const updateDoc ={
    $set:{
      role: 'admin'
    }
  }
  const result = await userCollecton.updateOne(filter, updateDoc)
  res.send(result)
})

app.delete('/users/admin/:id', async(req, res)=>{
  const id = req.params.id;
  const filter= {_id: new ObjectId(id)}
  const result= await userCollecton.deleteOne(filter)
  res.send(result)
})

app.get('/admin-status', verifyJWT, verifyAdmin, async(req, res)=>{
  const users = await userCollecton.estimatedDocumentCount()
  const orders = await paymentCollecton.estimatedDocumentCount()
  const products = await menuCollection.estimatedDocumentCount()

  //payment amount sum for best waye is mongodb group agrigate use
  // const result = await db.collection('payments').aggregate([
  //   {
  //     $group: {
  //       _id: null,
  //       totalAmount: { $sum: '$orderAmount' },
  //     },
  //   },
  // ]).toArray();
  // res.json({ totalAmount: result[0].totalAmount });

const payments = await paymentCollecton.find().toArray()
const revenue = payments.reduce((sum, item)=> sum + item.totalprice,0).toFixed(2)

  res.send({
    users,
    orders,
    products,
    revenue
  })
})


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res)=>{
    res.send('Bistro Boss Resturent Server Running')
})

app.listen(port, ()=>{
    console.log(`Bistro Boss Running on Port ${port}`);
})
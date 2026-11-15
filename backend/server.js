import express from 'express';
import cors from "cors";
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import authRoutes from "./routes/auth.js";


dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.send("hello world");
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`server is running on ${PORT}`);
});

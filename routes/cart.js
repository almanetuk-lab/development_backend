import express from "express";
import {getCartItems, addToCart, deleteCartItem} from  "../controller/cartController.js";
import { validateAccessToken } from "../middleware/verfiytoken.js";
const router = express.Router();

router.get("/:user_id",validateAccessToken, getCartItems);  // Get Cart Items by User ID
router.post("/",validateAccessToken, addToCart); // Add Item to Cart
router.delete("/:id", validateAccessToken,deleteCartItem); // Delete Cart Item by ID

export default router;

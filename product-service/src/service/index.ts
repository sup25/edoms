import Product from "../model/product.model";
import { TCreateProductRequest } from "../types";

export const createProductService = async ({
  name,
  price,
  slug,
}: TCreateProductRequest) => {
  const existingProduct = await Product.findOne({ where: { slug } });
  if (existingProduct) {
    throw new Error("Slug already exists. Please use a different slug.");
  }
  const product = await Product.create({ name, price, slug });
  return product;
};

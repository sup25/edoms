import Product from "../model/product.model";
import { TCreateProductRequest, TUpdateProductRequest } from "../types";

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

export const getAllProductsService = async (page: number, limit: number) => {
  const offset = (page - 1) * limit; // Calculate offset

  const { count, rows: products } = await Product.findAndCountAll({
    offset,
    limit,
  });

  return { products, totalProducts: count };
};

export const updateProductService = async ({
  name,
  price,
  slug,
  id,
}: TUpdateProductRequest) => {
  const product = await Product.findByPk(id);
  if (!product) {
    throw new Error("Product not found");
  }
  const existingProduct = await Product.findOne({ where: { slug } });
  if (existingProduct && existingProduct.id !== id) {
    throw new Error("Slug already exists");
  }
  const updatedProduct = await product.update({ name, price, slug });

  return updatedProduct;
};

export const deleteProductService = async (id: number) => {
  const product = await Product.findByPk(id);
  if (!product) {
    throw new Error("Product not found");
  }
  await product.destroy();
  return;
};
export const getProductByIdService = async (id: number) => {
  const product = await Product.findByPk(id);
  return product;
};

export const getProductBySlugService = async (slug: string) => {
  const product = await Product.findOne({ where: { slug } });
  return product;
};

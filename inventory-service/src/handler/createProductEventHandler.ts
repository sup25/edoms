import Stock from "../model/inventory.model";

interface ProductEvent {
  action: string;
  product: {
    id: number;
    initialStock: number;
  };
}

export async function handleCreateProductEvent(event: ProductEvent) {
  try {
    console.log("Processing event:", event);

    if (event.action === "ProductCreated") {
      // Check if stock entry already exists
      const existingStock = await Stock.findOne({
        where: { productId: event.product.id },
      });

      if (!existingStock) {
        // Create new stock entry
        await Stock.create({
          productId: event.product.id,
          stock: event.product.initialStock,
        });

        console.log(
          `Stock initialized for product ${event.product.id} with ${event.product.initialStock} units.`
        );
      } else {
        console.log(`Stock already exists for product ${event.product.id}`);
      }
    }
  } catch (error) {
    console.error("Error handling product event:", error);
  }
}
